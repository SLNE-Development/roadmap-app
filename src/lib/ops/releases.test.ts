import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, release, system } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { getProgress } from "./insight";
import { createRelease, deleteRelease, freezeRelease, unfreezeRelease, updateRelease } from "./releases";
import { createSystem, listSystems, updateSystem, updateSystems } from "./systems";
import { addTask } from "./tasks";

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
