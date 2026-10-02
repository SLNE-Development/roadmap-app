import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { githubInstallation, githubRepo, system } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { createTestDb } from "@/test/db";
import { addMemberFixture, completePlanningFixture, createProjectFixture } from "@/test/fixtures";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { linkPullRequest, pullRequestLinkContext, searchOpenTasks } from "./github-pr";
import { createSystem } from "./systems";
import { addTask, updateTask } from "./tasks";

/** Project P with systems Search (tasks Results, Index, a done one) and Old (archived), repos `Org/App` (app) and `Org/Hook` (webhook); project Q with a repo and a task. */
async function setup() {
  const db: Db = await createTestDb();
  const p = await createProjectFixture(db, "p");
  const editor = await addMemberFixture(db, p.owner, "p", "editor", "Ed");
  const viewer = await addMemberFixture(db, p.owner, "p", "viewer", "Vi");
  const q = await createProjectFixture(db, "q");
  await db.insert(githubInstallation).values({ id: 11, accountLogin: "Org", accountType: "Organization", repositorySelection: "all" });
  await db.insert(githubRepo).values([
    { id: "r1", projectId: p.projectId, fullName: "Org/App", fullNameKey: "org/app", mode: "app", githubRepoId: 1, installationId: 11 },
    { id: "r2", projectId: p.projectId, fullName: "Org/Hook", fullNameKey: "org/hook", mode: "webhook" },
    { id: "r3", projectId: q.projectId, fullName: "Org/Other", fullNameKey: "org/other", mode: "app", githubRepoId: 3, installationId: 11 },
  ]);
  const search = await createSystem(db, p.owner, "p", { slug: "search", title: "Search" });
  await completePlanningFixture(db, search.id);
  const { id: t1 } = await addTask(db, p.owner, "p", "search", { title: "Results" });
  const { id: t2 } = await addTask(db, p.owner, "p", "search", { title: "Index" });
  const { id: tDone } = await addTask(db, p.owner, "p", "search", { title: "Resolved" });
  await updateTask(db, p.owner, tDone, { state: "done" });
  const old = await createSystem(db, p.owner, "p", { slug: "old", title: "Old" });
  await addTask(db, p.owner, "p", "old", { title: "Resting" });
  await db.update(system).set({ archivedAt: new Date() }).where(eq(system.id, old.id));
  await createSystem(db, q.owner, "q", { slug: "other", title: "Other" });
  const { id: tq } = await addTask(db, q.owner, "q", "other", { title: "Foreign" });
  const api = fakeGitHubApi({
    pulls: {
      "Org/App#7": { title: "Add search", body: `Does stuff roadmap#${t1}`, state: "open", merged: false, htmlUrl: "https://github.com/Org/App/pull/7" },
    },
  });
  return { db, api, p, editor, viewer, q, t1, t2, tDone, tq };
}

describe("pullRequestLinkContext", () => {
  it("lists open tasks of active systems and the refs already on the PR", async () => {
    const w = await setup();
    const ctx = await pullRequestLinkContext(w.db, w.api, w.editor, "p", "r1", 7);
    expect(ctx.repo).toEqual({ id: "r1", fullName: "Org/App" });
    expect(ctx.pr).toEqual({ number: 7, title: "Add search", state: "open", merged: false, url: "https://github.com/Org/App/pull/7" });
    expect(ctx.linked).toEqual({ tasks: [w.t1], systems: [] });
    expect(ctx.systems).toEqual([
      {
        slug: "search",
        title: "Search",
        tasks: [
          { id: w.t1, title: "Results", state: "todo" },
          { id: w.t2, title: "Index", state: "todo" },
        ],
      },
    ]);
  });

  it("rejects a viewer", async () => {
    const w = await setup();
    await expect(pullRequestLinkContext(w.db, w.api, w.viewer, "p", "r1", 7)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not know a repository of another project", async () => {
    const w = await setup();
    await expect(pullRequestLinkContext(w.db, w.api, w.editor, "p", "r3", 7)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not know a missing pull request", async () => {
    const w = await setup();
    await expect(pullRequestLinkContext(w.db, w.api, w.editor, "p", "r1", 99)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a repository linked by hand", async () => {
    const w = await setup();
    await expect(pullRequestLinkContext(w.db, w.api, w.editor, "p", "r2", 7)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("linkPullRequest", () => {
  const updates = (api: Awaited<ReturnType<typeof setup>>["api"]) => api.calls.filter((c) => c.method === "updatePullRequest");

  it("adds the task ref to the body", async () => {
    const w = await setup();
    const res = await linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { taskId: w.t2 } });
    expect(res).toEqual({ changed: true, ref: `roadmap#${w.t2}` });
    expect(updates(w.api)).toHaveLength(1);
    expect((updates(w.api)[0].args[3] as { body: string }).body).toContain(`Roadmap: roadmap#${w.t2}`);
  });

  it("adds the ref to the title when it closes the task", async () => {
    const w = await setup();
    await linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { taskId: w.t2 }, closes: true });
    expect(updates(w.api)[0].args[3]).toEqual({ title: `Add search roadmap#${w.t2}` });
  });

  it("links a whole system", async () => {
    const w = await setup();
    const res = await linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { systemSlug: "search" } });
    expect(res).toEqual({ changed: true, ref: "roadmap:search" });
  });

  it("changes nothing when the ref is already there", async () => {
    const w = await setup();
    await linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { taskId: w.t2 } });
    const again = await linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { taskId: w.t2 } });
    expect(again).toEqual({ changed: false, ref: `roadmap#${w.t2}` });
    expect(updates(w.api)).toHaveLength(1);
  });

  it("rejects a viewer and does not call GitHub", async () => {
    const w = await setup();
    await expect(linkPullRequest(w.db, w.api, w.viewer, "p", { repoId: "r1", number: 7, target: { taskId: w.t2 } })).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.api.calls).toHaveLength(0);
  });

  it("does not know a repository of another project", async () => {
    const w = await setup();
    await expect(linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r3", number: 7, target: { taskId: w.t2 } })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not know a task or system of another project, or an archived system", async () => {
    const w = await setup();
    await expect(linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { taskId: w.tq } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { systemSlug: "other" } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(linkPullRequest(w.db, w.api, w.editor, "p", { repoId: "r1", number: 7, target: { systemSlug: "old" } })).rejects.toBeInstanceOf(NotFoundError);
    expect(updates(w.api)).toHaveLength(0);
  });
});

describe("searchOpenTasks", () => {
  it("matches titles case-insensitively, skips done tasks and archived systems, and treats wildcards literally", async () => {
    const w = await setup();
    expect(await searchOpenTasks(w.db, w.p.projectId, "res", 10)).toEqual([{ id: w.t1, title: "Results", systemTitle: "Search", systemSlug: "search" }]);
    expect(await searchOpenTasks(w.db, w.p.projectId, "%", 10)).toEqual([]);
    expect(await searchOpenTasks(w.db, w.p.projectId, "_", 10)).toEqual([]);
    expect(await searchOpenTasks(w.db, w.p.projectId, "", 1)).toHaveLength(1);
  });
});
