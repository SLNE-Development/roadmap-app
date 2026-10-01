import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { boardColumn, changeLog, system } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { setSystemArchived } from "./archive";
import { NotFoundError } from "./errors";
import { createBoard } from "./boards";
import { getColumnTimes, getProgress } from "./insight";
import { createPhase } from "./structure";
import { createSystem, moveSystem, updateSystem } from "./systems";
import { addTask, deleteTask, moveTask, updateTask } from "./tasks";

/** A project with the system `api` holding three tasks, the first done. */
async function setup() {
  const db = await createTestDb();
  const { owner, slug } = await createProjectFixture(db);
  const sys = await createSystem(db, owner, slug, { slug: "api", title: "API" });
  await completePlanningFixture(db, sys.id);
  const tasks = [];
  for (const title of ["A", "B", "C"]) tasks.push(await addTask(db, owner, slug, "api", { title }));
  await updateTask(db, owner, tasks[0].id, { state: "done" });
  return { db, owner, slug, sys, tasks };
}

describe("getProgress", () => {
  it("counts scope and done at the end", async () => {
    const { db, owner, slug } = await setup();
    const p = await getProgress(db, owner, slug, {});
    expect(p.points.at(-1)).toMatchObject({ scope: 3, done: 1 });
    expect(p.totals).toEqual({ scope: 3, done: 1 });
  });

  it("leaves out a deleted task", async () => {
    const { db, owner, slug, tasks } = await setup();
    await deleteTask(db, owner, tasks[2].id);
    const p = await getProgress(db, owner, slug, {});
    expect(p.points.at(-1)).toMatchObject({ scope: 2, done: 1 });
  });

  it("filters by phase", async () => {
    const { db, owner, slug } = await setup();
    const ph = await createPhase(db, owner, slug, { name: "Alpha" });
    const other = await createSystem(db, owner, slug, { slug: "web", title: "Web" });
    await completePlanningFixture(db, other.id);
    await updateSystem(db, owner, slug, "web", { phaseId: ph.id });
    await addTask(db, owner, slug, "web", { title: "W" });
    const p = await getProgress(db, owner, slug, { phase: ph.id });
    expect(p.totals).toEqual({ scope: 1, done: 0 });
  });

  it("excludes the tasks of an archived system", async () => {
    const { db, owner, slug } = await setup();
    await setSystemArchived(db, owner, slug, "api", true);
    const p = await getProgress(db, owner, slug, {});
    expect(p.totals).toEqual({ scope: 0, done: 0 });
  });

  it("excludes a task deleted in a phase-filtered system once it is deleted", async () => {
    const { db, owner, slug } = await setup();
    const ph = await createPhase(db, owner, slug, { name: "Alpha" });
    const web = await createSystem(db, owner, slug, { slug: "web", title: "Web" });
    await completePlanningFixture(db, web.id);
    await updateSystem(db, owner, slug, "web", { phaseId: ph.id });
    const keep = await addTask(db, owner, slug, "web", { title: "Keep" });
    const gone = await addTask(db, owner, slug, "web", { title: "Gone" });
    expect(keep.id).not.toBe(gone.id);
    expect((await getProgress(db, owner, slug, { phase: ph.id })).totals.scope).toBe(2);
    await deleteTask(db, owner, gone.id);
    expect((await getProgress(db, owner, slug, { phase: ph.id })).totals).toEqual({ scope: 1, done: 0 });
    expect((await getProgress(db, owner, slug, {})).totals.scope).toBe(4);
  });

  it("filters by board", async () => {
    const { db, owner, slug } = await setup();
    await createBoard(db, owner, slug, { slug: "ops", name: "Ops" });
    const web = await createSystem(db, owner, slug, { slug: "web", title: "Web" });
    await completePlanningFixture(db, web.id);
    await moveSystem(db, owner, slug, "web", { board: "ops", column: "Todo" });
    await addTask(db, owner, slug, "web", { title: "W" });
    expect((await getProgress(db, owner, slug, { board: "ops" })).totals).toEqual({ scope: 1, done: 0 });
    expect((await getProgress(db, owner, slug, { board: "development" })).totals.scope).toBe(3);
  });

  it("counts a moved task once", async () => {
    const { db, owner, slug, tasks } = await setup();
    const web = await createSystem(db, owner, slug, { slug: "web", title: "Web" });
    await completePlanningFixture(db, web.id);
    await moveTask(db, owner, tasks[0].id, { system: "web" });
    expect((await getProgress(db, owner, slug, {})).totals).toEqual({ scope: 3, done: 1 });
  });

  it("lets a viewer read and hides the project from a non-member", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    expect((await getProgress(db, viewer, slug, {})).totals.scope).toBe(3);
    const stranger = await insertUser(db, { name: "Stranger" });
    await expect(getProgress(db, stranger, slug, {})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("returns one point per day ending on the day of now", async () => {
    const { db, owner, slug } = await setup();
    const now = new Date(Date.now() + 30 * 86_400_000);
    const p = await getProgress(db, owner, slug, { days: 14 }, now);
    expect(p.points).toHaveLength(14);
    expect(p.points.at(-1)!.day).toBe(now.toISOString().slice(0, 10));
    expect(p.points.at(-1)).toMatchObject({ scope: 3, done: 1 });
  });
});

const NOW = new Date("2026-10-10T00:00:00Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(`2026-10-${String(n).padStart(2, "0")}T00:00:00Z`);

/** Back-dates a system's creation to `created` and its column moves, oldest first, to `moves`. */
async function setTimes(db: Db, systemId: string, created: Date, moves: Date[]) {
  await db.update(system).set({ createdAt: created }).where(eq(system.id, systemId));
  const rows = await db
    .select({ id: changeLog.id })
    .from(changeLog)
    .where(and(eq(changeLog.systemId, systemId), eq(changeLog.entity, "system"), eq(changeLog.field, "column")))
    .orderBy(asc(changeLog.id));
  expect(rows).toHaveLength(moves.length);
  for (const [i, r] of rows.entries()) await db.update(changeLog).set({ createdAt: moves[i] }).where(eq(changeLog.id, r.id));
}

describe("getColumnTimes", () => {
  async function twoSystems() {
    const { db, owner, slug } = await createTimed();
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    for (const s of [a, b]) await completePlanningFixture(db, s.id);
    for (const [key, cols] of [["a", ["In progress", "Review"]], ["b", ["In progress", "Done"]]] as const) {
      for (const column of cols) await moveSystem(db, owner, slug, key, { column });
    }
    // a: planning 1d, active 2d, review 5d; b: planning 1d, active 4d, done 3d
    await setTimes(db, a.id, day(1), [day(2), day(4)]);
    await setTimes(db, b.id, day(1), [day(2), day(6)]);
    return { db, owner, slug };
  }
  const createTimed = () => createTestDb().then(async (db) => ({ db, ...(await createProjectFixture(db)) }));

  it("takes the median of the time spent in a category and orders the stuck systems first", async () => {
    const { db, owner, slug } = await twoSystems();
    const t = await getColumnTimes(db, owner, slug, {}, NOW);
    expect(t.systems.map((s) => s.slug)).toEqual(["a", "b"]);
    expect(t.systems[0]).toMatchObject({ current: "review", currentSinceMs: 6 * DAY });
    expect(t.systems[1]).toMatchObject({ current: "done", currentSinceMs: 4 * DAY });
    expect(t.medians.active).toBe(3 * DAY);
    expect(t.medians.planning).toBe(DAY);
    expect(t.medians.review).toBe(6 * DAY);
    expect(t.medians.blocked).toBeNull();
  });

  it("leaves review null when no system has been in review", async () => {
    const { db, owner, slug } = await createTimed();
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await completePlanningFixture(db, a.id);
    await moveSystem(db, owner, slug, "a", { column: "In progress" });
    await setTimes(db, a.id, day(1), [day(3)]);
    const t = await getColumnTimes(db, owner, slug, {}, NOW);
    expect(t.medians.review).toBeNull();
    expect(t.medians.active).toBe(7 * DAY);
  });

  it("counts moves into a renamed column as unknown", async () => {
    const { db, owner, slug } = await createTimed();
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await completePlanningFixture(db, a.id);
    await moveSystem(db, owner, slug, "a", { column: "Review" });
    await setTimes(db, a.id, day(1), [day(3)]);
    await db.update(boardColumn).set({ name: "QA" }).where(eq(boardColumn.name, "Review"));
    const t = await getColumnTimes(db, owner, slug, {}, NOW);
    expect(t.systems[0].byCategory).toMatchObject({ planning: 2 * DAY, unknown: 7 * DAY });
  });

  it("filters by board and leaves out archived systems", async () => {
    const { db, owner, slug } = await twoSystems();
    await createBoard(db, owner, slug, { slug: "ops", name: "Ops" });
    expect((await getColumnTimes(db, owner, slug, { board: "ops" }, NOW)).systems).toEqual([]);
    await setSystemArchived(db, owner, slug, "a", true);
    expect((await getColumnTimes(db, owner, slug, {}, NOW)).systems.map((s) => s.slug)).toEqual(["b"]);
  });

  it("hides the project from a non-member", async () => {
    const { db, slug } = await createTimed();
    const stranger = await insertUser(db, { name: "Stranger" });
    await expect(getColumnTimes(db, stranger, slug, {}, NOW)).rejects.toBeInstanceOf(NotFoundError);
  });
});
