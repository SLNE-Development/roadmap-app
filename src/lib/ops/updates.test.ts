import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
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
