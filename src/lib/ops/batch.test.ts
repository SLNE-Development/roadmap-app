import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { changeLog, task } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { addTasks, answerQuestions, updateTasks } from "./batch";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { addQuestion, listQuestions } from "./questions";
import { createSystem } from "./systems";
import { moveTask } from "./tasks";

describe("batch tools", () => {
  it("adds tasks in input order with consecutive sort orders", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { tasks } = await addTasks(db, owner, slug, "s", { tasks: [{ title: "A", clientRef: "s1" }, { title: "B", clientRef: "s2" }] });
    expect(tasks.map((t) => [t.title, t.clientRef, t.created])).toEqual([
      ["A", "s1", true],
      ["B", "s2", true],
    ]);
    const rows = await db.select().from(task).where(eq(task.systemId, s.id));
    const order = new Map(rows.map((r) => [r.id, r.sortOrder]));
    expect(order.get(tasks[1].id)).toBe(order.get(tasks[0].id)! + 1);
  });

  it("returns the existing tasks on a retry with the same client refs", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const input = { tasks: [{ title: "A", clientRef: "s1" }, { title: "B", clientRef: "s2" }] };
    const first = await addTasks(db, owner, slug, "s", input);
    const again = await addTasks(db, owner, slug, "s", input);
    expect(again.tasks.map((t) => [t.id, t.created])).toEqual(first.tasks.map((t) => [t.id, false]));
    expect(await db.select().from(task).where(eq(task.systemId, s.id))).toHaveLength(2);

    const retry = await addTasks(db, owner, slug, "s", { tasks: [{ title: "Renamed", clientRef: "s1" }, { title: "C", clientRef: "s3" }] });
    expect(retry.tasks.map((t) => [t.title, t.created])).toEqual([
      ["A", false],
      ["C", true],
    ]);
    expect(retry.tasks[0].id).toBe(first.tasks[0].id);
    const rows = await db.select().from(task).where(eq(task.systemId, s.id));
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === first.tasks[0].id)?.title).toBe("A");
  });

  it("always creates items without a client ref", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await addTasks(db, owner, slug, "s", { tasks: [{ title: "A" }, { title: "A" }] });
    const { tasks } = await addTasks(db, owner, slug, "s", { tasks: [{ title: "A" }] });
    expect(tasks).toEqual([{ id: expect.any(Number), title: "A", clientRef: null, created: true }]);
    expect(await db.select().from(task).where(eq(task.systemId, s.id))).toHaveLength(3);
  });

  it("returns one task for a client ref repeated within a batch", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { tasks } = await addTasks(db, owner, slug, "s", { tasks: [{ title: "A", clientRef: "s1" }, { title: "B", clientRef: "s1" }] });
    expect(tasks.map((t) => [t.title, t.created])).toEqual([
      ["A", true],
      ["A", false],
    ]);
    expect(tasks[1].id).toBe(tasks[0].id);
    expect(await db.select().from(task).where(eq(task.systemId, s.id))).toHaveLength(1);
  });

  it("clears the client ref when a task moves into a system that has the same ref", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    const [moving] = (await addTasks(db, owner, slug, "a", { tasks: [{ title: "A1", clientRef: "step-1" }] })).tasks;
    await addTasks(db, owner, slug, "b", { tasks: [{ title: "B1", clientRef: "step-1" }] });
    await moveTask(db, owner, moving.id, { system: "b" });
    const [row] = await db.select().from(task).where(eq(task.id, moving.id));
    expect(row).toMatchObject({ systemId: b.id, clientRef: null });
  });

  it("refuses a viewer and writes nothing", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(addTasks(db, viewer, slug, "s", { tasks: [{ title: "A", clientRef: "s1" }] })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.select().from(task).where(eq(task.systemId, s.id))).toHaveLength(0);
  });

  it("refuses a viewer batch update and changes nothing", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    const [t1] = (await addTasks(db, owner, slug, "s", { tasks: [{ title: "T1" }] })).tasks;
    await expect(updateTasks(db, viewer, { updates: [{ id: t1.id, title: "X" }] })).rejects.toBeInstanceOf(ForbiddenError);
    const [row] = await db.select().from(task).where(eq(task.id, t1.id));
    expect(row.title).toBe("T1");
  });

  it("applies no update when one item names an unknown task", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const s = await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await completePlanningFixture(db, s.id);
    const { tasks } = await addTasks(db, owner, slug, "s", { tasks: [{ title: "T1" }] });
    const t1 = tasks[0].id;
    const attempt = updateTasks(db, owner, { updates: [{ id: t1, state: "done" }, { id: 999999, state: "done" }] });
    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt).rejects.toThrow(/^Item 2: /);
    const [row] = await db.select().from(task).where(eq(task.id, t1));
    expect(row.state).toBe("todo");
  });

  it("names the item that hits the planning gate and changes nothing", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { tasks } = await addTasks(db, owner, slug, "s", { tasks: [{ title: "T1" }] });
    const attempt = updateTasks(db, owner, { updates: [{ id: tasks[0].id, state: "doing", title: "Renamed" }] });
    await expect(attempt).rejects.toBeInstanceOf(ConflictError);
    await expect(attempt).rejects.toThrow(/^Item 1: /);
    const [row] = await db.select().from(task).where(eq(task.id, tasks[0].id));
    expect(row).toMatchObject({ state: "todo", title: "T1" });
  });

  it("updates tasks of two systems and logs each change once", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const a = await createSystem(db, owner, slug, { slug: "a", title: "A" });
    const b = await createSystem(db, owner, slug, { slug: "b", title: "B" });
    await completePlanningFixture(db, a.id);
    await completePlanningFixture(db, b.id);
    const [ta] = (await addTasks(db, owner, slug, "a", { tasks: [{ title: "TA" }] })).tasks;
    const [tb] = (await addTasks(db, owner, slug, "b", { tasks: [{ title: "TB" }] })).tasks;
    const { tasks } = await updateTasks(db, owner, { updates: [{ id: tb.id, state: "done" }, { id: ta.id, title: "TA2" }] });
    expect(tasks.map((t) => [t.id, t.title, t.state])).toEqual([
      [tb.id, "TB", "done"],
      [ta.id, "TA2", "todo"],
    ]);
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, "task"));
    expect(log.filter((e) => e.entityId === String(tb.id) && e.field === "state")).toHaveLength(1);
    expect(log.filter((e) => e.entityId === String(ta.id) && e.field === "title")).toHaveLength(1);
  });

  it("answers several questions, or none when one is unknown", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const q1 = await addQuestion(db, owner, slug, { title: "One?" });
    const q2 = await addQuestion(db, owner, slug, { title: "Two?" });
    const attempt = answerQuestions(db, owner, slug, { answers: [{ id: q1.id, answer: "Yes" }, { id: "missing", answer: "No" }] });
    await expect(attempt).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt).rejects.toThrow(/^Item 2: /);
    expect((await listQuestions(db, owner, slug)).every((q) => !q.resolved && q.answer === null)).toBe(true);

    const { questions } = await answerQuestions(db, owner, slug, { answers: [{ id: q2.id, answer: "B" }, { id: q1.id, answer: "A" }] });
    expect(questions.map((q) => [q.id, q.answer, q.resolved])).toEqual([
      [q2.id, "B", true],
      [q1.id, "A", true],
    ]);
  });

  it("rejects more than 50 items", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const many = Array.from({ length: 51 }, (_, i) => ({ title: `T${i}` }));
    await expect(addTasks(db, owner, slug, "s", { tasks: many })).rejects.toBeInstanceOf(ZodError);
    await expect(updateTasks(db, owner, { updates: Array.from({ length: 51 }, () => ({ id: 1, state: "done" as const })) })).rejects.toBeInstanceOf(ZodError);
    await expect(answerQuestions(db, owner, slug, { answers: Array.from({ length: 51 }, () => ({ id: "x", answer: "y" })) })).rejects.toBeInstanceOf(ZodError);
  });
});
