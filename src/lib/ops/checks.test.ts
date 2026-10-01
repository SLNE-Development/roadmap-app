import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, taskCheck } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { addCheck, deleteCheck, setTaskChecks, updateCheck } from "./checks";
import { getSystem, createSystem } from "./systems";
import { addTask, deleteTask } from "./tasks";

describe("task checks", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const task = await addTask(db, owner, slug, "s", { title: "T" });
    const checks = async () => (await getSystem(db, owner, slug, "s")).tasks[0].checks;
    return { db, owner, slug, task, checks };
  }

  it("adds checks in insertion order, not done", async () => {
    const { db, owner, task, checks } = await setup();
    await addCheck(db, owner, task.id, { title: "a" });
    await addCheck(db, owner, task.id, { title: "b" });
    expect((await checks()).map((c) => [c.title, c.done])).toEqual([["a", false], ["b", false]]);
  });

  it("updates a check and logs the change", async () => {
    const { db, owner, task, checks } = await setup();
    const { id } = await addCheck(db, owner, task.id, { title: "a" });
    await updateCheck(db, owner, id, { done: true });
    expect((await checks())[0].done).toBe(true);
    const log = await db.select().from(changeLog).where(eq(changeLog.entity, "check"));
    expect(log.map((l) => [l.entityId, l.field, l.newValue])).toContainEqual([id, "done", "true"]);
  });

  it("deletes a check", async () => {
    const { db, owner, task, checks } = await setup();
    const { id } = await addCheck(db, owner, task.id, { title: "a" });
    await deleteCheck(db, owner, id);
    expect(await checks()).toEqual([]);
  });

  it("replaces the list keeping ids of matching titles", async () => {
    const { db, owner, task, checks } = await setup();
    const a = await addCheck(db, owner, task.id, { title: "a" });
    await addCheck(db, owner, task.id, { title: "c" });
    const result = await setTaskChecks(db, owner, task.id, { items: [{ title: "b" }, { title: "a", done: true }] });
    expect(result).toEqual({ checks: 2, done: 1 });
    const list = await checks();
    expect(list.map((c) => [c.title, c.done])).toEqual([["b", false], ["a", true]]);
    expect(list[1].id).toBe(a.id);
    const log = await db.select().from(changeLog).where(eq(changeLog.field, "checks"));
    expect(log.map((l) => [l.entity, l.entityId, l.newValue])).toEqual([["task", String(task.id), "1/2"]]);
  });

  it("keeps the stored done state when done is omitted", async () => {
    const { db, owner, task, checks } = await setup();
    await setTaskChecks(db, owner, task.id, { items: [{ title: "a", done: true }] });
    expect(await setTaskChecks(db, owner, task.id, { items: [{ title: "a" }] })).toEqual({ checks: 1, done: 1 });
    expect((await checks())[0].done).toBe(true);
  });

  it("rejects more than 50 items", async () => {
    const { db, owner, task } = await setup();
    const items = Array.from({ length: 51 }, (_, i) => ({ title: `i${i}` }));
    await expect(setTaskChecks(db, owner, task.id, { items })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("forbids viewers", async () => {
    const { db, owner, slug, task } = await setup();
    const { id } = await addCheck(db, owner, task.id, { title: "a" });
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await expect(addCheck(db, viewer, task.id, { title: "x" })).rejects.toMatchObject({ status: 403 });
    await expect(updateCheck(db, viewer, id, { done: true })).rejects.toMatchObject({ status: 403 });
    await expect(deleteCheck(db, viewer, id)).rejects.toMatchObject({ status: 403 });
    await expect(setTaskChecks(db, viewer, task.id, { items: [] })).rejects.toMatchObject({ status: 403 });
  });

  it("deletes checks with their task", async () => {
    const { db, owner, task } = await setup();
    await addCheck(db, owner, task.id, { title: "a" });
    await deleteTask(db, owner, task.id);
    expect(await db.select().from(taskCheck)).toEqual([]);
  });
});
