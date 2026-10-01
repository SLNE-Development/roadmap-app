import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { listBlockedTasks } from "./blocked";
import { createSystem } from "./systems";
import { addTask, updateTask } from "./tasks";

describe("listBlockedTasks", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const ids: number[] = [];
    for (const key of ["a", "b"]) {
      const s = await createSystem(db, owner, slug, { slug: key, title: key.toUpperCase() });
      await completePlanningFixture(db, s.id);
      const blocked = await addTask(db, owner, slug, key, { title: `blocked ${key}` });
      const doing = await addTask(db, owner, slug, key, { title: `doing ${key}` });
      await updateTask(db, owner, blocked.id, { state: "blocked", blockedReason: `reason ${key}` });
      await updateTask(db, owner, doing.id, { state: "doing" });
      ids.push(blocked.id);
    }
    return { db, owner, slug, ids };
  }

  it("lists blocked tasks with reason, system and since", async () => {
    const { db, owner, slug, ids } = await setup();
    const list = await listBlockedTasks(db, owner, slug);
    expect(list.map((t) => [t.id, t.reason, t.systemSlug, t.systemTitle]).sort()).toEqual(
      [
        [ids[0], "reason a", "a", "A"],
        [ids[1], "reason b", "b", "B"],
      ].sort(),
    );
    expect(list.every((t) => t.since instanceof Date)).toBe(true);
  });

  it("is readable by a viewer", async () => {
    const { db, owner, slug } = await setup();
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    expect(await listBlockedTasks(db, viewer, slug)).toHaveLength(2);
  });

  it("hides the project from non-members", async () => {
    const { db, slug } = await setup();
    const stranger = await insertUser(db);
    await expect(listBlockedTasks(db, stranger, slug)).rejects.toMatchObject({ status: 404 });
  });
});
