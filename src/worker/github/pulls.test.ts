import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { codeLink, githubAccount, githubDelivery, githubInstallation, githubRepo } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { linksForSystem } from "@/lib/ops/github-links";
import { createSystem } from "@/lib/ops/systems";
import { addTask } from "@/lib/ops/tasks";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { testDeps } from "../deps";
import { handleGitHubEvent } from "./events";
import "./pulls";

const api = fakeGitHubApi();
const getApi = async () => api;
const repository = { id: 42, full_name: "Org/App" };

let seq = 0;

/** Runs one App delivery through the registered handler and returns its stored status and detail. */
async function deliver(db: Db, event: string, payload: unknown): Promise<{ status: string; detail: string | null }> {
  seq += 1;
  const deliveryId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  await db.insert(githubDelivery).values({ deliveryId, source: "app", event });
  await handleGitHubEvent({ deliveryId, event, source: "app", repoId: null, payload }, testDeps(db), getApi);
  const [row] = await db.select().from(githubDelivery).where(eq(githubDelivery.deliveryId, deliveryId));
  return { status: row.status, detail: row.detail };
}

/** Project P with system `search-index` holding t1 and t2, project Q with q1, and repo R linked to P in app mode. */
async function setup() {
  const db = await createTestDb();
  const p = await createProjectFixture(db, "p");
  const q = await createProjectFixture(db, "q");
  const system = await createSystem(db, p.owner, "p", { slug: "search-index", title: "Search index" });
  const { id: t1 } = await addTask(db, p.owner, "p", "search-index", { title: "Results" });
  const { id: t2 } = await addTask(db, p.owner, "p", "search-index", { title: "Ranking" });
  await createSystem(db, q.owner, "q", { slug: "other", title: "Other" });
  const { id: q1 } = await addTask(db, q.owner, "q", "other", { title: "Secret" });
  await db.insert(githubInstallation).values({ id: 7, accountLogin: "Org", accountType: "Organization", repositorySelection: "all" });
  await db
    .insert(githubRepo)
    .values({ id: "r1", projectId: p.projectId, fullName: "Org/App", fullNameKey: "org/app", mode: "app", githubRepoId: 42, installationId: 7, access: "ok" });
  return { db, p, q, systemId: system.id, t1, t2, q1 };
}

function pullRequest(action: string, title: string, body: string, extra: Record<string, unknown> = {}) {
  return {
    action,
    number: 419,
    repository,
    pull_request: {
      number: 419,
      title,
      body,
      html_url: "https://github.com/Org/App/pull/419",
      state: "open",
      merged: false,
      draft: false,
      head: { sha: "abc" },
      user: { login: "octo" },
      ...extra,
    },
  };
}

const links = (db: Db) => db.select().from(codeLink).orderBy(codeLink.targetKey);

describe("pull_request events", () => {
  it("links the referenced tasks and system, with title refs closing", async () => {
    const { db, systemId, t1, t2 } = await setup();
    const outcome = await deliver(db, "pull_request", pullRequest("opened", `feat: results [roadmap#${t1}]`, `also roadmap#${t2} roadmap:search-index`));
    expect(outcome).toEqual({ status: "done", detail: "linked 2 tasks, 1 system" });
    const rows = await links(db);
    expect(rows).toHaveLength(3);
    const byTarget = Object.fromEntries(rows.map((r) => [r.targetKey, r]));
    expect(byTarget[`task:${t1}`]).toMatchObject({ taskId: t1, systemId, closes: true, kind: "pr", refKey: "pr:419", number: 419, sha: "abc" });
    expect(byTarget[`task:${t2}`]).toMatchObject({ taskId: t2, systemId, closes: false });
    expect(byTarget[`system:${systemId}`]).toMatchObject({ taskId: null, systemId, closes: false });
    for (const row of rows) {
      expect(row).toMatchObject({ state: "open", checks: "pending", title: `feat: results [roadmap#${t1}]`, authorLogin: "octo", repoId: "r1" });
    }
  });

  it("ignores a task of another project", async () => {
    const { db, q1 } = await setup();
    const outcome = await deliver(db, "pull_request", pullRequest("opened", `roadmap#${q1}`, ""));
    expect(outcome).toEqual({ status: "done", detail: "no roadmap references" });
    expect(await links(db)).toEqual([]);
    expect(outcome.detail).not.toContain(String(q1));
  });

  it("ignores an app delivery for a repository linked by hand", async () => {
    const { db, t1 } = await setup();
    await db.update(githubRepo).set({ mode: "webhook", webhookSecretEnc: "x" }).where(eq(githubRepo.id, "r1"));
    expect(await deliver(db, "pull_request", pullRequest("opened", `roadmap#${t1}`, ""))).toEqual({ status: "ignored", detail: "linked by hand" });
    expect(await deliver(db, "push", { repository, commits: [{ id: "c1", message: `roadmap#${t1}`, url: "https://github.com/Org/App/commit/c1" }] })).toEqual({
      status: "ignored",
      detail: "linked by hand",
    });
    expect(await links(db)).toEqual([]);
  });

  it("ignores a roadmap:<slug> reference to another project's system", async () => {
    const { db, q } = await setup();
    await createSystem(db, q.owner, "q", { slug: "billing", title: "Billing" });
    const outcome = await deliver(db, "pull_request", pullRequest("opened", "feat", "roadmap:billing"));
    expect(outcome).toEqual({ status: "done", detail: "no roadmap references" });
    expect(await links(db)).toEqual([]);
  });

  it("stores only GitHub URLs on code links", async () => {
    const { db, t1 } = await setup();
    await deliver(db, "pull_request", pullRequest("opened", `roadmap#${t1}`, "", { html_url: "https://evil.example/pull/419" }));
    await deliver(db, "push", { repository, commits: [{ id: "c1", message: `roadmap#${t1}`, url: "javascript:alert(1)" }] });
    const rows = await links(db);
    expect(rows.map((r) => r.url).sort()).toEqual(["https://github.com/Org/App/commit/c1", "https://github.com/Org/App/pull/419"]);
  });

  it("deletes the links of references removed by an edit", async () => {
    const { db, systemId, t1, t2 } = await setup();
    const title = `feat: results [roadmap#${t1}]`;
    await deliver(db, "pull_request", pullRequest("opened", title, `also roadmap#${t2} roadmap:search-index`));
    await deliver(db, "pull_request", pullRequest("edited", title, "also roadmap:search-index"));
    expect((await links(db)).map((r) => r.targetKey)).toEqual([`system:${systemId}`, `task:${t1}`]);
  });

  it("marks the links merged when the pull request is merged", async () => {
    const { db, t1 } = await setup();
    const title = `feat: results [roadmap#${t1}]`;
    await deliver(db, "pull_request", pullRequest("opened", title, ""));
    await deliver(db, "pull_request", pullRequest("closed", title, "", { state: "closed", merged: true }));
    const [row] = await links(db);
    expect(row).toMatchObject({ taskId: t1, state: "merged", checks: "pending" });
  });

  it("ignores a delivery for a repository that isn't linked", async () => {
    const { db, t1 } = await setup();
    const payload = { ...pullRequest("opened", `roadmap#${t1}`, ""), repository: { id: 7, full_name: "Org/Other" } };
    expect(await deliver(db, "pull_request", payload)).toEqual({ status: "ignored", detail: "repository not linked" });
    expect(await links(db)).toEqual([]);
  });

  it("is idempotent when the same delivery runs twice", async () => {
    const { db, t1, t2 } = await setup();
    const payload = pullRequest("opened", `feat: results [roadmap#${t1}]`, `also roadmap#${t2} roadmap:search-index`);
    await deliver(db, "pull_request", payload);
    const first = await links(db);
    await deliver(db, "pull_request", payload);
    expect((await links(db)).map((r) => r.id)).toEqual(first.map((r) => r.id));
  });
});

const callsOf = (method: string) => api.calls.filter((c) => c.method === method);

describe("the roadmap comment", () => {
  beforeEach(() => {
    api.calls.length = 0;
    api.seed.comments = {};
    api.seed.failWith = undefined;
  });

  it("comments once on open, then stays quiet while nothing changes", async () => {
    const { db, t1 } = await setup();
    await deliver(db, "pull_request", pullRequest("opened", `roadmap#${t1}`, ""));
    expect(callsOf("createComment")).toHaveLength(1);
    expect(String(callsOf("createComment")[0].args[3])).toContain(`roadmap#${t1}`);
    await deliver(db, "pull_request", pullRequest("edited", `roadmap#${t1}`, ""));
    expect(callsOf("createComment")).toHaveLength(1);
    expect(callsOf("updateComment")).toHaveLength(0);
  });

  it("skips the write when a re-delivered open finds a matching comment", async () => {
    const { db, t1 } = await setup();
    const payload = pullRequest("opened", `roadmap#${t1}`, "");
    await deliver(db, "pull_request", payload);
    api.calls.length = 0;
    await deliver(db, "pull_request", payload);
    expect(callsOf("findComment")).toHaveLength(1);
    expect(callsOf("createComment")).toHaveLength(0);
    expect(callsOf("updateComment")).toHaveLength(0);
  });

  it("updates the comment when the ref is removed", async () => {
    const { db, t1 } = await setup();
    await deliver(db, "pull_request", pullRequest("opened", `roadmap#${t1}`, ""));
    await deliver(db, "pull_request", pullRequest("edited", "plain title", ""));
    expect(callsOf("updateComment")).toHaveLength(1);
    expect(String(callsOf("updateComment")[0].args[3])).toContain("no longer linked");
  });

  it("makes no comment calls without refs", async () => {
    const { db } = await setup();
    await deliver(db, "pull_request", pullRequest("opened", "plain title", ""));
    expect(api.calls.filter((c) => c.method.endsWith("Comment"))).toEqual([]);
  });

  it("ends done with a note when GitHub refuses the comment, keeping the link", async () => {
    const { db, t1 } = await setup();
    api.seed.failWith = { createComment: 403 };
    const outcome = await deliver(db, "pull_request", pullRequest("opened", `roadmap#${t1}`, ""));
    expect(outcome.status).toBe("done");
    expect(outcome.detail).toContain("comment skipped: GitHub refused (403)");
    expect(await links(db)).toHaveLength(1);
  });

  it("doesn't call GitHub for a repository linked by hand", async () => {
    const { db, t1 } = await setup();
    await db.update(githubRepo).set({ mode: "webhook", webhookSecretEnc: "x" }).where(eq(githubRepo.id, "r1"));
    seq += 1;
    const deliveryId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
    await db.insert(githubDelivery).values({ deliveryId, source: "repo", event: "pull_request" });
    await handleGitHubEvent({ deliveryId, event: "pull_request", source: "repo", repoId: "r1", payload: pullRequest("opened", `roadmap#${t1}`, "") }, testDeps(db), getApi);
    expect(await links(db)).toHaveLength(1);
    expect(callsOf("findComment")).toEqual([]);
  });
});

describe("push events", () => {
  it("links commits that mention a task", async () => {
    const { db, systemId, t1 } = await setup();
    const outcome = await deliver(db, "push", {
      repository,
      deleted: false,
      commits: [
        { id: "c1", message: `fix: ranking roadmap#${t1}\n\nlonger text`, url: "https://github.com/Org/App/commit/c1", author: { username: "octo" } },
        { id: "c2", message: "chore: tidy", url: "https://github.com/Org/App/commit/c2" },
      ],
    });
    expect(outcome).toEqual({ status: "done", detail: "linked 1 task, 0 systems" });
    expect(await links(db)).toEqual([
      expect.objectContaining({
        kind: "commit",
        refKey: "commit:c1",
        targetKey: `task:${t1}`,
        taskId: t1,
        systemId,
        sha: "c1",
        number: null,
        state: "merged",
        checks: null,
        closes: false,
        title: "fix: ranking roadmap#" + t1,
        url: "https://github.com/Org/App/commit/c1",
        authorLogin: "octo",
      }),
    ]);
  });

  it("ignores a push that deletes a branch", async () => {
    const { db } = await setup();
    expect((await deliver(db, "push", { repository, deleted: true, commits: [] })).status).toBe("ignored");
  });
});

describe("linksForSystem", () => {
  it("lists a system's links for a viewer, with the author's name from their GitHub account", async () => {
    const { db, p, t1 } = await setup();
    await db.insert(githubAccount).values({ userId: p.owner.userId, githubId: 500, login: "Octo" });
    await deliver(db, "pull_request", pullRequest("opened", `roadmap#${t1}`, ""));
    const viewer = await addMemberFixture(db, p.owner, "p", "viewer");
    expect(await linksForSystem(db, viewer, "p", "search-index")).toEqual([
      expect.objectContaining({ kind: "pr", number: 419, taskId: t1, repoFullName: "Org/App", authorLogin: "octo", authorName: "Owner", checks: "pending" }),
    ]);
  });
});
