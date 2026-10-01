import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { notification } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { withAgent } from "./actor";
import { updateProject } from "./projects";
import { createSystem } from "./systems";
import { addTask } from "./tasks";
import { commitUrl, latestUpdates, listUpdates, postUpdate } from "./updates";

describe("commitUrl", () => {
  it("joins the repository URL and hash", () => {
    expect(commitUrl("https://github.com/x/y/", "abc1234")).toBe("https://github.com/x/y/commit/abc1234");
    expect(commitUrl(null, "abc1234")).toBeNull();
    expect(commitUrl("https://github.com/x/y", null)).toBeNull();
  });
});

describe("progress updates", () => {
  it("stores updates with task, commit and agent, newest first", async () => {
    const db = await createTestDb();
    const { owner, slug, projectId } = await createProjectFixture(db);
    await updateProject(db, owner, slug, { repoUrl: "https://github.com/x/y" });
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id: taskId } = await addTask(db, owner, slug, "s", { title: "T" });
    await postUpdate(db, owner, slug, "s", { summary: "First" });
    const posted = await postUpdate(db, withAgent(owner, "Claude Code"), slug, "s", { summary: "Second", taskId, commit: "ABCDEF1" });
    expect(posted.commitUrl).toBe("https://github.com/x/y/commit/abcdef1");
    const updates = await listUpdates(db, owner, slug, { system: "s" });
    expect(updates.map((u) => [u.summary, u.author, u.authorName, u.agent, u.isAgent, u.taskTitle])).toEqual([
      ["Second", "Claude Code (for Owner)", "Owner", "Claude Code", true, "T"],
      ["First", "Owner", "Owner", null, false, null],
    ]);
    expect([...(await latestUpdates(db, projectId)).values()].map((u) => u.summary)).toEqual(["Second"]);
  });

  it("rejects bad commit hashes and tasks of other systems", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "a", title: "A" });
    await createSystem(db, owner, slug, { slug: "b", title: "B" });
    const { id } = await addTask(db, owner, slug, "b", { title: "T" });
    await expect(postUpdate(db, owner, slug, "a", { summary: "x", commit: "xyz" })).rejects.toThrow(/commit/);
    await expect(postUpdate(db, owner, slug, "a", { summary: "x", taskId: id })).rejects.toMatchObject({
      status: 400,
      message: `Task ${id} does not belong to system a.`,
    });
  });
});

describe("mentions in updates", () => {
  it("stores @Jules in an update as a token and notifies Jules once", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const jules = await addMemberFixture(db, owner, slug, "editor", "Jules");
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    const { id } = await postUpdate(db, owner, slug, "s", { summary: "Done, @Jules", nextStep: "@Jules reviews" });
    const [u] = await listUpdates(db, owner, slug);
    expect([u.summary, u.nextStep]).toEqual([`Done, [@Jules](user:${jules.userId})`, `[@Jules](user:${jules.userId}) reviews`]);
    const rows = await db.select().from(notification).where(eq(notification.userId, jules.userId));
    expect(rows.map((r) => [r.kind, r.href, r.sourceKey])).toEqual([["mention", "/p/demo/systems/s", `update:${id}:mention:${jules.userId}`]]);
  });
});

describe("update cursor", () => {
  it("pages newest first without gaps or repeats", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    for (const n of [1, 2, 3, 4, 5]) await postUpdate(db, owner, slug, "s", { summary: `U${n}` });
    const first = await listUpdates(db, owner, slug, { limit: 2 });
    const second = await listUpdates(db, owner, slug, { limit: 2, before: first.at(-1)!.id });
    const third = await listUpdates(db, owner, slug, { limit: 2, before: second.at(-1)!.id });
    expect([...first, ...second, ...third].map((u) => u.summary)).toEqual(["U5", "U4", "U3", "U2", "U1"]);
    expect(await listUpdates(db, owner, slug, { limit: 2, before: third.at(-1)!.id })).toEqual([]);
  });
});

describe("update filters", () => {
  it("filters by person and by agent", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const editor = await addMemberFixture(db, owner, slug, "editor", "Edie");
    await createSystem(db, owner, slug, { slug: "s", title: "S" });
    await postUpdate(db, owner, slug, "s", { summary: "By owner" });
    await postUpdate(db, editor, slug, "s", { summary: "By editor" });
    await postUpdate(db, withAgent(owner, "Claude Code"), slug, "s", { summary: "By agent" });
    const summaries = async (f: Parameters<typeof listUpdates>[3]) => (await listUpdates(db, owner, slug, f)).map((u) => u.summary).sort();
    expect(await summaries({ person: editor.userId })).toEqual(["By editor"]);
    expect(await summaries({ agents: "only" })).toEqual(["By agent"]);
    expect(await summaries({ agents: "exclude" })).toEqual(["By editor", "By owner"]);
  });
});
