import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
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

describe("listActivity filters", () => {
  async function seed() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor", "Edie");
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await addTask(db, editor, slug, "a", { title: "T" });
    await updateSystem(db, withAgent(owner, "Claude Code"), slug, "a", { notes: "n" });
    return { db, owner, editor, slug };
  }

  it("filters by person", async () => {
    const { db, owner, editor, slug } = await seed();
    const rows = await listActivity(db, owner, slug, { person: editor.userId });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.authorName === "Edie")).toBe(true);
  });

  it("filters to agents only or without agents", async () => {
    const { db, owner, slug } = await seed();
    const only = await listActivity(db, owner, slug, { agents: "only" });
    expect(only.map((r) => `${r.entity}:${r.field}`)).toEqual(["system:notes"]);
    const exclude = await listActivity(db, owner, slug, { agents: "exclude" });
    expect(exclude.length).toBeGreaterThan(0);
    expect(exclude.every((r) => r.agent === null)).toBe(true);
  });

  it("filters by entity group", async () => {
    const { db, owner, slug } = await seed();
    const tasks = await listActivity(db, owner, slug, { groups: ["tasks"] });
    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks.every((r) => r.entity === "task")).toBe(true);
    const both = await listActivity(db, owner, slug, { groups: ["tasks", "systems"] });
    expect(new Set(both.map((r) => r.entity))).toEqual(new Set(["task", "system"]));
  });

  it("pages with the before cursor", async () => {
    const { db, owner, slug } = await seed();
    const all = await listActivity(db, owner, slug);
    const older = await listActivity(db, owner, slug, { before: all[1].id });
    expect(older.map((r) => r.id)).toEqual(all.slice(2).map((r) => r.id));
  });
});
