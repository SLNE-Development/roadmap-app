import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { boardColumn, changeLog, release, releaseNote, system } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { getProgress } from "./insight";
import { acceptAdr, createAdr } from "./adrs";
import { setColumnRules } from "./boards";
import { addQuestion } from "./questions";
import {
  createRelease,
  deleteRelease,
  freezeRelease,
  getRelease,
  getReleaseNote,
  listReleases,
  releaseRisk,
  shipRelease,
  unfreezeRelease,
  updateRelease,
  writeReleaseNote,
} from "./releases";
import { createSystem, listSystems, updateSystem, updateSystems } from "./systems";
import { addTask } from "./tasks";
import { postUpdate } from "./updates";

/** A project with an editor, and the systems `a`, `b` and `c`. */
async function setup() {
  const db = await createTestDb();
  const { owner, slug, projectId } = await createProjectFixture(db);
  const editor = await addMemberFixture(db, owner, slug, "editor");
  for (const s of ["a", "b", "c"]) await createSystem(db, owner, slug, { slug: s, title: s.toUpperCase() });
  return { db, owner, editor, slug, projectId };
}

describe("releases", () => {
  it("lets an editor create a release and assign a system, logging the release name", async () => {
    const { db, editor, slug, projectId } = await setup();
    await createRelease(db, editor, slug, { slug: "1-0", name: "1.0" });
    await updateSystem(db, editor, slug, "a", { release: "1-0" });
    const items = await listSystems(db, editor, slug);
    expect(items.find((s) => s.slug === "a")).toMatchObject({ releaseSlug: "1-0", releaseName: "1.0" });
    expect(items.find((s) => s.slug === "b")).toMatchObject({ releaseSlug: null, releaseName: null });
    const [entry] = await db.select().from(changeLog).where(and(eq(changeLog.projectId, projectId), eq(changeLog.field, "release"), eq(changeLog.entity, "system")));
    expect([entry.oldValue, entry.newValue]).toEqual([null, "1.0"]);
    const [created] = await db.select().from(changeLog).where(and(eq(changeLog.entity, "release"), eq(changeLog.field, "created")));
    expect(created.newValue).toBe("1.0");
  });

  it("rejects a duplicate slug", async () => {
    const { db, editor, slug } = await setup();
    await createRelease(db, editor, slug, { slug: "1-0", name: "1.0" });
    await expect(createRelease(db, editor, slug, { slug: "1-0", name: "Again" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("logs release field changes", async () => {
    const { db, editor, slug } = await setup();
    await createRelease(db, editor, slug, { slug: "1-0", name: "1.0" });
    await updateRelease(db, editor, slug, "1-0", { name: "One", targetDate: "2026-12-01" });
    const rows = await db.select().from(changeLog).where(and(eq(changeLog.entity, "release"), eq(changeLog.field, "name")));
    expect([rows[0].oldValue, rows[0].newValue]).toEqual(["1.0", "One"]);
    const dates = await db.select().from(changeLog).where(and(eq(changeLog.entity, "release"), eq(changeLog.field, "targetDate")));
    expect([dates[0].oldValue, dates[0].newValue]).toEqual([null, "2026-12-01"]);
  });

  it("restricts a frozen release's scope to owners", async () => {
    const { db, owner, editor, slug } = await setup();
    await createRelease(db, editor, slug, { slug: "1-0", name: "1.0" });
    await updateSystem(db, editor, slug, "a", { release: "1-0" });
    await freezeRelease(db, owner, slug, "1-0");
    const denied = updateSystem(db, editor, slug, "b", { release: "1-0" });
    await expect(denied).rejects.toBeInstanceOf(ForbiddenError);
    await expect(denied).rejects.toThrow("1.0 is frozen; only an owner can change its scope.");
    await expect(updateSystem(db, editor, slug, "a", { release: null })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSystems(db, editor, slug, { systems: ["b"], patch: { release: "1-0" } })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateRelease(db, editor, slug, "1-0", { name: "x" })).rejects.toBeInstanceOf(ForbiddenError);

    await updateSystem(db, owner, slug, "b", { release: "1-0" });
    const [entry] = await db.select().from(changeLog).where(and(eq(changeLog.field, "release"), eq(changeLog.entity, "system"), eq(changeLog.newValue, "1.0")));
    expect(entry).toBeDefined();
    expect((await listSystems(db, owner, slug, { release: "1-0" })).map((s) => s.slug)).toEqual(["a", "b"]);
  });

  it("refuses every assignment change on a shipped release", async () => {
    const { db, owner, slug, projectId } = await setup();
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    await updateSystem(db, owner, slug, "a", { release: "1-0" });
    await db.update(release).set({ status: "shipped" }).where(eq(release.projectId, projectId));
    await expect(updateSystem(db, owner, slug, "b", { release: "1-0" })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateSystem(db, owner, slug, "a", { release: null })).rejects.toBeInstanceOf(ConflictError);
  });

  it("filters systems by release", async () => {
    const { db, owner, slug } = await setup();
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    await createRelease(db, owner, slug, { slug: "2-0", name: "2.0" });
    await updateSystem(db, owner, slug, "a", { release: "1-0" });
    await updateSystem(db, owner, slug, "b", { release: "2-0" });
    expect((await listSystems(db, owner, slug, { release: "1-0" })).map((s) => s.slug)).toEqual(["a"]);
    expect(await listSystems(db, owner, slug, { release: "9-9" })).toEqual([]);
  });

  it("moves a system between planned releases and rejects unknown ones", async () => {
    const { db, owner, slug } = await setup();
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    await createRelease(db, owner, slug, { slug: "2-0", name: "2.0" });
    await updateSystem(db, owner, slug, "a", { release: "1-0" });
    await updateSystem(db, owner, slug, "a", { release: "2-0" });
    await expect(updateSystem(db, owner, slug, "a", { release: "nope" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("needs an owner to unfreeze and delete only planned releases", async () => {
    const { db, owner, editor, slug } = await setup();
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    await freezeRelease(db, owner, slug, "1-0");
    await expect(unfreezeRelease(db, editor, slug, "1-0")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(freezeRelease(db, editor, slug, "1-0")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteRelease(db, owner, slug, "1-0")).rejects.toBeInstanceOf(ConflictError);
    await unfreezeRelease(db, owner, slug, "1-0");
    await updateSystem(db, editor, slug, "a", { release: "1-0" });
    await deleteRelease(db, owner, slug, "1-0");
    expect((await listSystems(db, owner, slug)).find((s) => s.slug === "a")?.releaseSlug).toBeNull();
    const [gone] = await db.select().from(changeLog).where(and(eq(changeLog.entity, "release"), eq(changeLog.field, "deleted")));
    expect(gone.oldValue).toBe("1.0");
  });

  it("hides releases from non-members", async () => {
    const { db, slug } = await setup();
    const stranger = await insertUser(db);
    await expect(createRelease(db, stranger, slug, { slug: "1-0", name: "1.0" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("getProgress release filter", () => {
  it("counts only the tasks of the release's systems", async () => {
    const { db, owner, slug } = await setup();
    await db.update(system).set({ planningCompletedAt: new Date() });
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    await updateSystem(db, owner, slug, "a", { release: "1-0" });
    await addTask(db, owner, slug, "a", { title: "one" });
    await addTask(db, owner, slug, "b", { title: "two" });
    await addTask(db, owner, slug, "b", { title: "three" });
    expect((await getProgress(db, owner, slug, { release: "1-0" })).totals.scope).toBe(1);
    expect((await getProgress(db, owner, slug, {})).totals.scope).toBe(3);
    await expect(getProgress(db, owner, slug, { release: "nope" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

/** Moves the systems into their board's Done column without the planning and gate checks. */
async function markDone(db: Awaited<ReturnType<typeof setup>>["db"], slugs: string[]) {
  const [done] = await db.select().from(boardColumn).where(eq(boardColumn.category, "done"));
  for (const s of slugs) await db.update(system).set({ columnId: done.id }).where(eq(system.slug, s));
}

describe("releaseRisk", () => {
  const range = { status: "range", paceLow: 1, paceHigh: 2, earliest: "2026-10-20", latest: "2026-10-29" } as const;

  it("compares the projected range with the target", () => {
    expect(releaseRisk("planned", "2026-10-24", range)).toBe("at-risk");
    expect(releaseRisk("planned", "2026-10-29", range)).toBe("on-track");
    expect(releaseRisk("planned", "2026-10-19", range)).toBe("late");
    expect(releaseRisk("planned", null, range)).toBe("unknown");
    expect(releaseRisk("frozen", "2026-10-24", { status: "none", reason: "no-pace" })).toBe("unknown");
    expect(releaseRisk("shipped", "2026-10-01", range)).toBe("on-track");
  });
});

describe("getRelease and listReleases", () => {
  it("reports systems, counts, estimates, open questions and unmet gates", async () => {
    const { db, owner, slug } = await setup();
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0", targetDate: "2026-12-01" });
    await createRelease(db, owner, slug, { slug: "0-9", name: "0.9" });
    await updateSystem(db, owner, slug, "a", { release: "1-0" });
    await updateSystem(db, owner, slug, "b", { release: "1-0" });
    await addTask(db, owner, slug, "a", { title: "one", estimate: "M" });
    await addTask(db, owner, slug, "b", { title: "two" });
    await addQuestion(db, owner, slug, { title: "Which?", system: "b" });
    await setColumnRules(db, owner, slug, "development", { column: "Done", rules: [{ rule: "all-tasks-done" }] });
    await markDone(db, ["a"]);
    const detail = await getRelease(db, owner, slug, "1-0");
    expect(detail.systems.map((s) => [s.slug, s.category, s.tasksTotal, s.gatesUnmet, s.gatesTotal])).toEqual([
      ["a", "done", 1, 1, 1],
      ["b", "planning", 1, 1, 1],
    ]);
    expect(detail.counts).toMatchObject({ done: 1, planning: 1, todo: 0 });
    expect(detail.estimates).toMatchObject({ tasks: 2, points: 3, unestimated: 1 });
    expect(detail.openQuestions.map((q) => [q.title, q.systemSlug])).toEqual([["Which?", "b"]]);
    expect(detail.risk).toBe("unknown");
    expect(detail.latestNote).toBeNull();
    const list = await listReleases(db, owner, slug);
    expect(list.map((r) => [r.slug, r.systemCount, r.doneCount])).toEqual([
      ["1-0", 2, 1],
      ["0-9", 0, 0],
    ]);
  });
});

describe("shipRelease", () => {
  /** A release holding a (done, summary, accepted ADR), b (done, update) and c (not done). */
  async function shippable() {
    const ctx = await setup();
    const { db, owner, slug } = ctx;
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    for (const s of ["a", "b", "c"]) await updateSystem(db, owner, slug, s, { release: "1-0" });
    await updateSystem(db, owner, slug, "a", { summary: "Find anything." });
    await postUpdate(db, owner, slug, "b", { summary: "Exports landed\nwith detail" });
    const { number } = await createAdr(db, owner, slug, { title: "Use SSE", context: "c", decision: "d", alternatives: "a", consequences: "x", systems: ["a", "b"] });
    await acceptAdr(db, owner, slug, number);
    await markDone(db, ["a", "b"]);
    return ctx;
  }

  it("blocks while systems are unfinished", async () => {
    const { db, owner, slug } = await shippable();
    const attempt = shipRelease(db, owner, slug, "1-0", {});
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow("1 of 3 systems aren't done: C. Ship with unfinished: unassign to move them out.");
  });

  it("unassigns unfinished systems, logs them and writes note version 1", async () => {
    const { db, owner, slug } = await shippable();
    const row = await shipRelease(db, owner, slug, "1-0", { unfinished: "unassign" });
    expect(row.status).toBe("shipped");
    expect(row.shippedAt).not.toBeNull();
    const [c] = await db.select().from(system).where(eq(system.slug, "c"));
    expect(c.releaseId).toBeNull();
    const [entry] = await db.select().from(changeLog).where(and(eq(changeLog.entity, "system"), eq(changeLog.field, "release"), eq(changeLog.systemId, c.id), isNull(changeLog.newValue)));
    expect([entry.oldValue, entry.newValue]).toEqual(["1.0", null]);
    const note = await getReleaseNote(db, owner, slug, "1-0");
    expect(note.version).toBe(1);
    const [y, m, d] = (row.shippedAt as Date).toISOString().slice(0, 10).split("-").map(Number);
    const label = `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
    expect(note.body).toBe(
      `# 1.0\n\nShipped ${label}.\n\n## Shipped\n\n- **A**: Find anything.\n- **B**: Exports landed\n\n## Decisions\n\n- ADR-0001 Use SSE\n\n## Not shipped\n\n- C`,
    );
    await expect(shipRelease(db, owner, slug, "1-0", {})).rejects.toBeInstanceOf(ConflictError);
    expect((await getRelease(db, owner, slug, "1-0")).risk).toBe("on-track");
  });

  it("needs an owner", async () => {
    const { db, editor, slug } = await shippable();
    await expect(shipRelease(db, editor, slug, "1-0", { unfinished: "unassign" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("release notes", () => {
  it("versions writes and reads a given version", async () => {
    const { db, owner, editor, slug } = await setup();
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    await shipRelease(db, owner, slug, "1-0", {});
    expect(await writeReleaseNote(db, editor, slug, "1-0", "second")).toEqual({ version: 2 });
    expect(await writeReleaseNote(db, editor, slug, "1-0", "third")).toEqual({ version: 3 });
    expect((await getReleaseNote(db, owner, slug, "1-0", 2)).body).toBe("second");
    expect((await getReleaseNote(db, owner, slug, "1-0")).version).toBe(3);
    await expect(getReleaseNote(db, owner, slug, "1-0", 9)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("gives concurrent writes distinct versions", async () => {
    const { db, owner, slug } = await setup();
    await createRelease(db, owner, slug, { slug: "1-0", name: "1.0" });
    const results = await Promise.all([writeReleaseNote(db, owner, slug, "1-0", "x"), writeReleaseNote(db, owner, slug, "1-0", "y")]);
    expect(results.map((r) => r.version).sort()).toEqual([1, 2]);
    expect(await db.select().from(releaseNote)).toHaveLength(2);
  });
});
