import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { githubDelivery, githubInstallation, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { createSystem } from "@/lib/ops/systems";
import { addTask } from "@/lib/ops/tasks";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { testDeps } from "../deps";
import { handleGitHubEvent } from "./events";
import "./comments";

const repository = { id: 42, full_name: "Org/App" };
let seq = 0;

type Api = ReturnType<typeof fakeGitHubApi>;

/** Runs one App delivery through the registered handler and returns its stored status and detail. */
async function deliver(db: Db, api: Api, payload: unknown): Promise<{ status: string; detail: string | null }> {
  seq += 1;
  const deliveryId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  await db.insert(githubDelivery).values({ deliveryId, source: "app", event: "issue_comment" });
  await handleGitHubEvent({ deliveryId, event: "issue_comment", source: "app", repoId: null, payload }, testDeps(db), async () => api);
  const [row] = await db.select().from(githubDelivery).where(eq(githubDelivery.deliveryId, deliveryId));
  return { status: row.status, detail: row.detail };
}

/** Project P with t1 "Results" and t2 "Ranking", project Q with q1 "Secret", repo R linked to P, and PR Org/App#7. */
async function setup(body = "") {
  const db = await createTestDb();
  const p = await createProjectFixture(db, "p");
  const q = await createProjectFixture(db, "q");
  await createSystem(db, p.owner, "p", { slug: "search-index", title: "Search index" });
  const { id: t1 } = await addTask(db, p.owner, "p", "search-index", { title: "Results" });
  const { id: t2 } = await addTask(db, p.owner, "p", "search-index", { title: "Ranking" });
  await createSystem(db, q.owner, "q", { slug: "other", title: "Other" });
  const { id: q1 } = await addTask(db, q.owner, "q", "other", { title: "Secret" });
  await db.insert(githubInstallation).values({ id: 7, accountLogin: "Org", accountType: "Organization", repositorySelection: "all" });
  await db
    .insert(githubRepo)
    .values({ id: "r1", projectId: p.projectId, fullName: "Org/App", fullNameKey: "org/app", mode: "app", githubRepoId: 42, installationId: 7, access: "ok" });
  const api = fakeGitHubApi({ pulls: { "Org/App#7": { title: "feat: search", body, state: "open", merged: false, htmlUrl: "https://github.com/Org/App/pull/7" } } });
  return { db, api, t1, t2, q1 };
}

function comment(body: string, extra: { association?: string; user?: Record<string, unknown>; action?: string } = {}) {
  return {
    action: extra.action ?? "created",
    repository,
    issue: { number: 7, pull_request: {}, user: { id: 1 } },
    comment: { body, author_association: extra.association ?? "OWNER", user: extra.user ?? { id: 2, type: "User" } },
  };
}

const methods = (api: Api) => api.calls.map((c) => c.method);
const createdBody = (api: Api) => String(api.calls.find((c) => c.method === "createComment")?.args[3]);

describe("/roadmap comments", () => {
  it("offers the picker for an empty query", async () => {
    const { db, api } = await setup();
    expect(await deliver(db, api, comment("/roadmap"))).toEqual({ status: "done", detail: "picker offered" });
    expect(api.calls.filter((c) => c.method === "createComment")).toHaveLength(1);
    expect(createdBody(api)).toContain("/p/p/link-pr?repo=");
    expect(createdBody(api)).toContain("pr=7");
  });

  it("adds the ref of a unique title match to the body", async () => {
    const { db, api, t1 } = await setup();
    expect(await deliver(db, api, comment("/roadmap Results"))).toEqual({ status: "done", detail: "added 1 refs" });
    const updates = api.calls.filter((c) => c.method === "updatePullRequest");
    expect(updates).toHaveLength(1);
    expect((updates[0].args[3] as { body: string }).body.endsWith(`Roadmap: roadmap#${t1}`)).toBe(true);
    expect(methods(api)).not.toContain("createComment");
  });

  it("does not edit when the ref is already present", async () => {
    const { db, api, t1 } = await setup();
    api.seed.pulls["Org/App#7"].body = `Roadmap: roadmap#${t1}`;
    await deliver(db, api, comment(`/roadmap roadmap#${t1}`));
    expect(methods(api)).not.toContain("updatePullRequest");
  });

  it("never reveals another project's task", async () => {
    const { db, api, q1 } = await setup();
    await deliver(db, api, comment(`/roadmap roadmap#${q1}`));
    expect(methods(api)).not.toContain("updatePullRequest");
    expect(createdBody(api)).toContain(`roadmap#${q1}\` isn't a task or system of this project`);
    expect(createdBody(api)).not.toContain("Secret");
  });

  it("lists several matches", async () => {
    const { db, api, t1, t2 } = await setup();
    await deliver(db, api, comment("/roadmap r"));
    expect(methods(api)).not.toContain("updatePullRequest");
    expect(createdBody(api)).toContain("Several tasks match");
    expect(createdBody(api)).toContain(`roadmap#${t1}`);
    expect(createdBody(api)).toContain(`roadmap#${t2}`);
  });

  it("says when nothing matches", async () => {
    const { db, api } = await setup();
    await deliver(db, api, comment("/roadmap zzz"));
    expect(createdBody(api)).toContain('No open task matches "zzz"');
  });

  it("ignores strangers without any API call", async () => {
    const { db, api } = await setup();
    expect(await deliver(db, api, comment("/roadmap", { association: "NONE" }))).toEqual({ status: "ignored", detail: "not allowed" });
    expect(api.calls).toEqual([]);
  });

  it("handles the pull request's author whatever their association", async () => {
    const { db, api } = await setup();
    const outcome = await deliver(db, api, comment("/roadmap", { association: "NONE", user: { id: 1, type: "User" } }));
    expect(outcome.status).toBe("done");
  });

  it("ignores bots and the App's own comments", async () => {
    const { db, api } = await setup();
    expect(await deliver(db, api, comment("/roadmap", { user: { id: 2, type: "Bot" } }))).toEqual({ status: "ignored", detail: "bot comment" });
    const viaApp = comment("/roadmap");
    (viaApp.comment as Record<string, unknown>).performed_via_github_app = { id: 1 };
    expect(await deliver(db, api, viaApp)).toEqual({ status: "ignored", detail: "bot comment" });
    expect(api.calls).toEqual([]);
  });

  it("ignores plain issues, other actions and other text", async () => {
    const { db, api } = await setup();
    const issue = comment("/roadmap");
    delete (issue.issue as Record<string, unknown>).pull_request;
    expect(await deliver(db, api, issue)).toEqual({ status: "ignored", detail: "not a pull request" });
    expect(await deliver(db, api, comment("/roadmap", { action: "edited" }))).toEqual({ status: "ignored", detail: "issue_comment.edited" });
    expect(await deliver(db, api, comment("hello"))).toEqual({ status: "ignored", detail: "no command" });
    expect(api.calls).toEqual([]);
  });

  it("ends done with the note when GitHub refuses the edit", async () => {
    const { db, api } = await setup();
    api.seed.failWith = { updatePullRequest: 403 };
    const outcome = await deliver(db, api, comment("/roadmap Results"));
    expect(outcome.status).toBe("done");
    expect(outcome.detail).toContain("GitHub refused (403)");
  });
});
