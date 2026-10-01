import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { task } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { listActivity } from "./activity";
import { groupRollups, phaseRollups, rollup, systemRollups } from "./rollups";
import { createPhase } from "./structure";
import { createSystem, getSystem, listSystems } from "./systems";
import { addTask, updateTask } from "./tasks";

describe("rollup", () => {
  it("is zero for no tasks", () => {
    expect(rollup([])).toEqual({ tasks: 0, done: 0, points: 0, pointsDone: 0, unestimated: 0 });
  });

  it("sums points and counts done and unestimated tasks", () => {
    expect(
      rollup([
        { state: "done", estimate: "L" },
        { state: "todo", estimate: "M" },
        { state: "todo", estimate: null },
      ]),
    ).toEqual({ tasks: 3, done: 1, points: 11, pointsDone: 8, unestimated: 1 });
  });
});

describe("rollups with the database", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    const phaseA = await createPhase(db, owner, slug, { name: "A" });
    await createSystem(db, owner, slug, { slug: "a1", title: "A1", phaseId: phaseA.id });
    await createSystem(db, owner, slug, { slug: "a2", title: "A2", phaseId: phaseA.id });
    await createSystem(db, owner, slug, { slug: "n1", title: "N1" });
    const specs: [string, "S" | "M" | "L" | null, boolean][] = [
      ["a1", "S", true],
      ["a1", "L", false],
      ["a1", null, false],
      ["a2", "M", true],
      ["n1", "L", true],
      ["n1", null, false],
    ];
    for (const [system, estimate, done] of specs) {
      const { id } = await addTask(db, owner, slug, system, { title: "T", estimate });
      if (done) await db.update(task).set({ state: "done" }).where(eq(task.id, id));
    }
    return { db, owner, slug, projectId, phaseA };
  }

  it("matches the pure rollup per system", async () => {
    const { db, owner, slug, projectId } = await setup();
    const rollups = await systemRollups(db, projectId);
    for (const s of await listSystems(db, owner, slug)) {
      const { tasks } = await getSystem(db, owner, slug, s.slug);
      expect(rollups.get(s.id)).toEqual(rollup(tasks));
      expect(s).toMatchObject({ points: rollup(tasks).points, pointsDone: rollup(tasks).pointsDone, unestimated: rollup(tasks).unestimated });
    }
    const [a1] = (await listSystems(db, owner, slug)).filter((s) => s.slug === "a1");
    expect(await systemRollups(db, projectId, [a1.id])).toEqual(new Map([[a1.id, { tasks: 3, done: 1, points: 9, pointsDone: 1, unestimated: 1 }]]));
  });

  it("groups by phase with null for systems without one", async () => {
    const { db, projectId, phaseA } = await setup();
    const groups = await groupRollups(db, projectId, "phase");
    expect([...groups.keys()]).toEqual([null, phaseA.id].sort());
    expect(groups.get(phaseA.id)).toEqual({ tasks: 4, done: 2, points: 12, pointsDone: 4, unestimated: 1 });
    expect(groups.get(null)).toEqual({ tasks: 2, done: 1, points: 8, pointsDone: 8, unestimated: 1 });
  });

  it("groups by board", async () => {
    const { db, projectId } = await setup();
    const groups = await groupRollups(db, projectId, "board");
    expect(groups.size).toBe(1);
    expect([...groups.values()][0]).toMatchObject({ tasks: 6, points: 20 });
  });
});

describe("phaseRollups", () => {
  it("lists rollups per phase for viewers and hides the project from strangers", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const phase = await createPhase(db, owner, slug, { name: "A" });
    await createSystem(db, owner, slug, { slug: "a", title: "A", phaseId: phase.id });
    await addTask(db, owner, slug, "a", { title: "T", estimate: "L" });
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    expect(await phaseRollups(db, viewer, slug)).toEqual([{ phaseId: phase.id, tasks: 1, done: 0, points: 8, pointsDone: 0, unestimated: 0 }]);
    await expect(phaseRollups(db, await insertUser(db), slug)).rejects.toMatchObject({ status: 404 });
  });
});

describe("task estimates", () => {
  it("logs setting and clearing an estimate", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await updateTask(db, owner, id, { estimate: "M" });
    expect((await getSystem(db, owner, slug, "s")).tasks[0].estimate).toBe("M");
    await updateTask(db, owner, id, { estimate: null });
    expect((await getSystem(db, owner, slug, "s")).tasks[0].estimate).toBeNull();
    const entries = (await listActivity(db, owner, slug)).filter((e) => e.field === "estimate");
    expect(entries.map((e) => [e.oldValue, e.newValue])).toEqual([
      ["M", null],
      [null, "M"],
    ]);
  });
});
