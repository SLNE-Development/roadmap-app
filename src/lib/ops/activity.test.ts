import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { listActivity } from "./activity";
import { createSystem, updateSystem } from "./systems";
import { addTask } from "./tasks";

describe("listActivity", () => {
  it("lists project changes newest first and narrows to one system's history", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    await addTask(db, owner, slug, "a", { title: "T" });
    await updateSystem(db, owner, slug, "a", { notes: "n" });
    const all = await listActivity(db, owner, slug);
    expect(all[0]).toMatchObject({ entity: "system", field: "notes", author: "Owner" });
    expect(all.at(-1)).toMatchObject({ entity: "project", field: "created" });
    const history = await listActivity(db, owner, slug, { system: "a" });
    expect(history.map((h) => `${h.entity}:${h.field}`)).toEqual(["system:notes", "task:created", "system:created"]);
  });
});
