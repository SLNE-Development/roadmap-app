import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { withAgent } from "./actor";
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
    expect(all[0]).toMatchObject({ entity: "system", field: "notes", author: "Owner", authorName: "Owner", agent: null });
    expect(all.at(-1)).toMatchObject({ entity: "project", field: "created" });
    const history = await listActivity(db, owner, slug, { system: "a" });
    expect(history.map((h) => `${h.entity}:${h.field}`)).toEqual(["system:notes", "task:created", "system:created"]);
  });

  it("names the person and the agent of agent changes separately", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, withAgent(owner, "Claude Code"), slug, { slug: "a", title: "A" });
    expect((await listActivity(db, owner, slug))[0]).toMatchObject({ author: "Claude Code (for Owner)", authorName: "Owner", agent: "Claude Code" });
  });
});
