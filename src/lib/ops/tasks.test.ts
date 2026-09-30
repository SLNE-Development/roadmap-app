import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { listActivity } from "./activity";
import { withAgent } from "./actor";
import { writeSpec } from "./documents";
import { addPlanningRound, answerPlanningItems } from "./planning";
import { createSystem, getSystem, updateSystem } from "./systems";
import { addTask, deleteTask, updateTask } from "./tasks";

describe("tasks", () => {
  it("adds tasks at the end with the system's priority", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S", priority: "MVP" });
    await addTask(db, owner, slug, "s", { title: "First" });
    await addTask(db, owner, slug, "s", { title: "Second", priority: "Later" });
    const { tasks } = await getSystem(db, owner, slug, "s");
    expect(tasks.map((t) => [t.title, t.priority, t.state])).toEqual([
      ["First", "MVP", "todo"],
      ["Second", "Later", "todo"],
    ]);
  });

  it("appends after the last task even after deletes", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await addTask(db, owner, slug, "s", { title: "1" });
    const middle = await addTask(db, owner, slug, "s", { title: "2" });
    await addTask(db, owner, slug, "s", { title: "3" });
    await deleteTask(db, owner, middle.id);
    await addTask(db, owner, slug, "s", { title: "4" });
    const { tasks } = await getSystem(db, owner, slug, "s");
    expect(tasks.map((t) => t.title)).toEqual(["1", "3", "4"]);
  });

  it("blocks doing and done while the system is in planning", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await expect(updateTask(db, owner, id, { state: "doing" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining(`Task ${id} cannot be doing while system s is still in planning. Missing:`),
    });
    await updateTask(db, owner, id, { state: "blocked" });
    await completePlanningFixture(db, s.id);
    await updateTask(db, owner, id, { state: "done", title: "Renamed" });
    expect((await getSystem(db, owner, slug, "s")).tasks[0]).toMatchObject({ state: "done", title: "Renamed" });
  });

  it("points at complete_planning when no gaps are left", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { itemIds } = await addPlanningRound(db, owner, slug, "s", {
      items: (["failure-modes", "dependencies", "scope", "ops-testing"] as const).map((area) => ({ area, question: area })),
    });
    await answerPlanningItems(db, owner, slug, "s", { answers: itemIds.map((itemId) => ({ itemId, answer: "ok" })) });
    await writeSpec(db, owner, slug, "s", { body: "# Spec" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await expect(updateTask(db, owner, id, { state: "doing" })).rejects.toMatchObject({
      status: 409,
      message: `Task ${id} cannot be doing while system s is still in planning. Call complete_planning first.`,
    });
  });

  it("assigns the task and the system to whoever starts the task, keeping existing owners", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor");
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    const first = await addTask(db, owner, slug, "s", { title: "First" });
    const second = await addTask(db, owner, slug, "s", { title: "Second" });
    await updateTask(db, owner, second.id, { ownerUserId: owner.userId });

    await updateTask(db, withAgent(editor, "Claude Code"), first.id, { state: "doing" });
    await updateTask(db, editor, second.id, { state: "doing" });

    const detail = await getSystem(db, owner, slug, "s");
    expect(detail.tasks.map((t) => [t.title, t.ownerName])).toEqual([
      ["First", "editor member"],
      ["Second", "Owner"],
    ]);
    expect(detail.ownerName).toBe("editor member");
  });

  it("does not assign admins who are not project members", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const admin = await insertUser(db, { isAdmin: true });
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await updateTask(db, admin, id, { state: "doing" });
    const detail = await getSystem(db, owner, slug, "s");
    expect([detail.tasks[0].ownerName, detail.ownerName]).toEqual([null, null]);
  });

  it("hides tasks of projects the actor cannot see and deletes tasks", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const other = await createProjectFixture(db, "other");
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await expect(updateTask(db, other.owner, id, { title: "x" })).rejects.toMatchObject({ status: 404, message: `Unknown task ${id}.` });
    await updateSystem(db, owner, slug, "s", { notes: "keep" });
    await deleteTask(db, owner, id);
    expect((await getSystem(db, owner, slug, "s")).tasks).toEqual([]);
  });

  it("keeps a single owner when two members start the same task at once", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const a = await addMemberFixture(db, owner, slug, "editor");
    const b = await addMemberFixture(db, owner, slug, "editor");
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });

    const results = await Promise.allSettled([updateTask(db, a, id, { state: "doing" }), updateTask(db, b, id, { state: "doing" })]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    const detail = await getSystem(db, owner, slug, "s");
    const names = [a, b].map((m) => m.name);
    expect(names).toContain(detail.ownerName);
    expect(names).toContain(detail.tasks[0].ownerName);
    expect(detail.tasks[0].ownerName).toBe(detail.ownerName);
    const owners = (await listActivity(db, owner, slug)).filter((h) => h.entity === "system" && h.field === "owner");
    expect(owners).toHaveLength(1);
  });
});
