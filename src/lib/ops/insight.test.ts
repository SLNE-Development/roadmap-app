import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { setSystemArchived } from "./archive";
import { NotFoundError } from "./errors";
import { getProgress } from "./insight";
import { createPhase } from "./structure";
import { createSystem, updateSystem } from "./systems";
import { addTask, deleteTask, updateTask } from "./tasks";

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
