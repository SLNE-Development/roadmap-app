import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notification } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { listActivity } from "./activity";
import { withAgent } from "./actor";
import { writePlan, writeSpec } from "./documents";
import { addPlanningRound, answerPlanningItems } from "./planning";
import { createSystem, getSystem, listSystems, updateSystem } from "./systems";
import { addTask, deleteTask, moveTask, reorderTasks, updateTask } from "./tasks";
import { listUpdates, postUpdate } from "./updates";

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
    await updateTask(db, owner, id, { state: "blocked", blockedReason: "waiting" });
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

  it("still reports unknown and invisible tasks as not found", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    const stranger = await insertUser(db);
    await expect(updateTask(db, stranger, id, { title: "x" })).rejects.toMatchObject({ status: 404, message: `Unknown task ${id}.` });
    await expect(updateTask(db, owner, 999999, { title: "x" })).rejects.toMatchObject({ status: 404, message: "Unknown task 999999." });
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

describe("notes and blocked reason", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    return { db, owner, slug, id };
  }

  it("requires a reason to block", async () => {
    const { db, owner, id } = await setup();
    await expect(updateTask(db, owner, id, { state: "blocked" })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining("blockedReason"),
    });
  });

  it("stores and logs the reason, then clears it when the state changes", async () => {
    const { db, owner, slug, id } = await setup();
    await updateTask(db, owner, id, { state: "blocked", blockedReason: "waiting for API key" });
    expect((await getSystem(db, owner, slug, "s")).tasks[0]).toMatchObject({ state: "blocked", blockedReason: "waiting for API key" });
    expect((await listSystems(db, owner, slug))[0].tasksBlocked).toBe(1);
    let log = (await listActivity(db, owner, slug)).filter((h) => h.entity === "task");
    expect(log.some((h) => h.field === "state" && h.newValue === "blocked")).toBe(true);
    expect(log.some((h) => h.field === "blockedReason" && h.newValue === "waiting for API key")).toBe(true);

    await updateTask(db, owner, id, { state: "doing" });
    expect((await getSystem(db, owner, slug, "s")).tasks[0].blockedReason).toBeNull();
    expect((await listSystems(db, owner, slug))[0].tasksBlocked).toBe(0);
    log = (await listActivity(db, owner, slug)).filter((h) => h.entity === "task");
    expect(log.some((h) => h.field === "blockedReason" && h.oldValue === "waiting for API key" && h.newValue === null)).toBe(true);
  });

  it("keeps the existing reason when blocking again without one", async () => {
    const { db, owner, slug, id } = await setup();
    await updateTask(db, owner, id, { state: "blocked", blockedReason: "r" });
    await updateTask(db, owner, id, { title: "T2" });
    expect((await getSystem(db, owner, slug, "s")).tasks[0].blockedReason).toBe("r");
  });

  it("refuses a reason on a task that is not blocked", async () => {
    const { db, owner, id } = await setup();
    await expect(updateTask(db, owner, id, { blockedReason: "x" })).rejects.toMatchObject({ status: 400, message: `Task ${id} is not blocked.` });
  });

  it("stores long notes and logs them cut to 200 characters", async () => {
    const { db, owner, slug, id } = await setup();
    await updateTask(db, owner, id, { notes: "a".repeat(300) });
    expect((await getSystem(db, owner, slug, "s")).tasks[0].notes).toHaveLength(300);
    const entry = (await listActivity(db, owner, slug)).find((h) => h.entity === "task" && h.field === "notes");
    expect(entry?.newValue).toHaveLength(201);
    expect(entry?.newValue?.endsWith("…")).toBe(true);
  });
});

describe("reorder and move", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    const { createdTasks } = await writePlan(db, owner, slug, "a", {
      body: "## Plan",
      steps: [1, 2, 3].map((step) => ({ step, title: `T${step}` })),
    });
    const [t1, t2, t3] = createdTasks;
    return { db, owner, slug, a, b, t1, t2, t3 };
  }

  it("reorders the tasks of a system and logs one entry", async () => {
    const { db, owner, slug, a, t1, t2, t3 } = await setup();
    await reorderTasks(db, owner, slug, "a", { orderedIds: [t3, t1, t2] });
    expect((await getSystem(db, owner, slug, "a")).tasks.map((t) => t.id)).toEqual([t3, t1, t2]);
    const entries = (await listActivity(db, owner, slug)).filter((h) => h.entity === "task" && h.field === "position");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entityId: a.id, newValue: "reordered" });
  });

  it("rejects lists that are not a permutation of the system's tasks", async () => {
    const { db, owner, slug, t1, t2 } = await setup();
    await expect(reorderTasks(db, owner, slug, "a", { orderedIds: [t1, t2] })).rejects.toMatchObject({ status: 400 });
    await expect(reorderTasks(db, owner, slug, "a", { orderedIds: [t1, t1, t2] })).rejects.toMatchObject({ status: 400 });
  });

  it("moves a task to another system, resetting its plan step and logging both systems", async () => {
    const { db, owner, slug, t2 } = await setup();
    await moveTask(db, owner, t2, { system: "b" });
    const b = await getSystem(db, owner, slug, "b");
    expect(b.tasks.map((t) => [t.id, t.title, t.planStep])).toEqual([[t2, "T2", null]]);
    expect((await getSystem(db, owner, slug, "a")).tasks.map((t) => t.id)).not.toContain(t2);
    const moved = (await listActivity(db, owner, slug)).filter((h) => h.entity === "task" && h.field === "moved");
    expect(moved).toHaveLength(2);
    expect(moved.map((h) => [h.oldValue, h.newValue])).toEqual([["a", "b"], ["a", "b"]]);
  });

  it("refuses to move a doing task into a system still in planning", async () => {
    const { db, owner, a, t1 } = await setup();
    await completePlanningFixture(db, a.id);
    await updateTask(db, owner, t1, { state: "doing" });
    await expect(moveTask(db, owner, t1, { system: "b" })).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("System b is still in planning."),
    });
  });

  it("does not move into a system of another project, or to the same system", async () => {
    const { db, owner, t1 } = await setup();
    const other = await createProjectFixture(db, "other");
    await createSystem(db, other.owner, other.slug, { slug: "x", title: "X" });
    await expect(moveTask(db, owner, t1, { system: "x" })).rejects.toMatchObject({ status: 404, message: "Unknown system x." });
    await expect(moveTask(db, owner, t1, { system: "a" })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps progress updates pointing at the moved task", async () => {
    const { db, owner, slug, t2 } = await setup();
    await postUpdate(db, owner, slug, "a", { summary: "did it", taskId: t2 });
    await moveTask(db, owner, t2, { system: "b" });
    expect((await listUpdates(db, owner, slug, { system: "a" }))[0].taskId).toBe(t2);
  });
});

describe("mentions in task notes", () => {
  it("stores @Jules in notes as a token and notifies Jules", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const jules = await addMemberFixture(db, owner, slug, "editor", "Jules");
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await addTask(db, owner, slug, "s", { title: "T" });
    await updateTask(db, owner, id, { notes: "@Jules knows" });
    const { tasks } = await getSystem(db, owner, slug, "s");
    expect(tasks[0].notes).toBe(`[@Jules](user:${jules.userId}) knows`);
    const rows = await db.select().from(notification).where(eq(notification.userId, jules.userId));
    expect(rows.map((r) => [r.kind, r.href, r.sourceKey])).toEqual([["mention", `/p/demo/systems/s#task-${id}`, `task:${id}:notes:mention:${jules.userId}`]]);
  });
});
