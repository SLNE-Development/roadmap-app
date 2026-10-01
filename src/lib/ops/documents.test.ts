import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture, insertUser } from "@/test/fixtures";
import { withAgent } from "./actor";
import { compareDocuments, getDocument, writePlan, writeSpec } from "./documents";
import { createSystem, getSystem } from "./systems";
import { moveTask } from "./tasks";

describe("specs", () => {
  it("appends versions and returns the latest or a given one", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    expect(await getDocument(db, owner, slug, "s", "spec")).toBeNull();
    await writeSpec(db, owner, slug, "s", { body: "# v1" });
    await writeSpec(db, withAgent(owner, "Claude Code"), slug, "s", { body: "# v2" });
    const latest = await getDocument(db, owner, slug, "s", "spec");
    expect(latest).toMatchObject({ version: 2, body: "# v2", author: "Claude Code (for Owner)", authorName: "Owner", agent: "Claude Code", versions: [2, 1] });
    expect((await getDocument(db, owner, slug, "s", "spec", 1))?.body).toBe("# v1");
    await expect(getDocument(db, owner, slug, "s", "spec", 9)).rejects.toMatchObject({ status: 404, message: "System s has no spec version 9." });
  });

  it("gives parallel writers distinct consecutive versions", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const results = await Promise.all([1, 2, 3].map((n) => writeSpec(db, owner, slug, "s", { body: `# ${n}` })));
    expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3]);
  });

  it("needs the editor role", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const viewer = await addMemberFixture(db, owner, slug, "viewer");
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(writeSpec(db, viewer, slug, "s", { body: "x" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("comparing versions", () => {
  async function setup() {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await writeSpec(db, owner, slug, "s", { body: "a" });
    await writeSpec(db, owner, slug, "s", { body: "b" });
    return { db, owner, slug };
  }

  it("counts added and removed lines between two versions", async () => {
    const { db, owner, slug } = await setup();
    const result = await compareDocuments(db, owner, slug, "s", "spec", 1, 2);
    expect(result).toMatchObject({ kind: "spec", added: 1, removed: 1 });
    expect([result.from.version, result.to.version]).toEqual([1, 2]);
  });

  it("rejects a reversed range and an unknown version", async () => {
    const { db, owner, slug } = await setup();
    await expect(compareDocuments(db, owner, slug, "s", "spec", 2, 1)).rejects.toMatchObject({ status: 400, message: "from must be lower than to." });
    await expect(compareDocuments(db, owner, slug, "s", "spec", 1, 9)).rejects.toMatchObject({ status: 404 });
  });

  it("returns only the diff from getDocument with since", async () => {
    const { db, owner, slug } = await setup();
    const result = await getDocument(db, owner, slug, "s", "spec", undefined, 1);
    expect(result).toMatchObject({ version: 2, since: 1, versions: [2, 1] });
    expect(result?.diff).toContain("-a");
    expect(result?.diff).toContain("+b");
    expect(result).not.toHaveProperty("body");
    await expect(getDocument(db, owner, slug, "s", "spec", undefined, 2)).rejects.toMatchObject({ status: 400 });
  });

  it("is hidden from non-members", async () => {
    const { db, slug } = await setup();
    const stranger = await insertUser(db);
    await expect(compareDocuments(db, stranger, slug, "s", "spec", 1, 2)).rejects.toMatchObject({ status: 404 });
  });
});

describe("plans", () => {
  it("creates a task per new step, renames changed steps and reports dropped ones", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S", priority: "MVP" });
    const first = await writePlan(db, owner, slug, "s", {
      body: "## Plan",
      steps: [
        { step: 1, title: "Schema" },
        { step: 2, title: "API" },
      ],
    });
    expect(first.version).toBe(1);
    expect(first.createdTasks).toHaveLength(2);
    const second = await writePlan(db, owner, slug, "s", {
      body: "## Plan v2",
      steps: [
        { step: 1, title: "Schema and migrations" },
        { step: 3, title: "UI" },
      ],
    });
    expect(second).toMatchObject({ version: 2, renamedTasks: [first.createdTasks[0]], missingSteps: [2] });
    const { tasks } = await getSystem(db, owner, slug, "s");
    expect(tasks.map((t) => [t.planStep, t.title, t.priority])).toEqual([
      [1, "Schema and migrations", "MVP"],
      [2, "API", "MVP"],
      [3, "UI", "MVP"],
    ]);
  });

  it("creates a new task for a step whose task moved to another system", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    const steps = [1, 2, 3].map((step) => ({ step, title: `Step ${step}` }));
    const first = await writePlan(db, owner, slug, "a", { body: "## Plan", steps });
    await moveTask(db, owner, first.createdTasks[1], { system: "b" });
    const second = await writePlan(db, owner, slug, "a", { body: "## Plan v2", steps });
    expect(second.createdTasks).toHaveLength(1);
    expect(second.renamedTasks).toEqual([]);
    expect((await getSystem(db, owner, slug, "b")).tasks[0].title).toBe("Step 2");
  });

  it("rejects duplicate step numbers", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await expect(
      writePlan(db, owner, slug, "s", {
        body: "x",
        steps: [
          { step: 1, title: "A" },
          { step: 1, title: "B" },
        ],
      }),
    ).rejects.toThrow(/step numbers must be unique/);
  });
});
