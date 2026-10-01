import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { codeLink, githubDelivery, githubInstallation, githubRepo, notification, system } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { createSystem } from "@/lib/ops/systems";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { testDeps } from "../deps";
import { aggregateChecks } from "./checks";
import { handleGitHubEvent } from "./events";

const done = (conclusion: string) => ({ status: "completed", conclusion });

describe("aggregateChecks", () => {
  it("is pending without suites", () => {
    expect(aggregateChecks([])).toBe("pending");
  });
  it("is pending while a suite is running", () => {
    expect(aggregateChecks([done("success"), { status: "in_progress", conclusion: null }])).toBe("pending");
  });
  it("counts neutral and skipped as passing", () => {
    expect(aggregateChecks([done("neutral"), done("skipped")])).toBe("success");
  });
  it("fails on a failing conclusion", () => {
    expect(aggregateChecks([done("success"), done("timed_out")])).toBe("failure");
    for (const c of ["failure", "cancelled", "action_required", "startup_failure"]) expect(aggregateChecks([done(c)])).toBe("failure");
  });
});

const api = fakeGitHubApi();
const getApi = async () => api;

let seq = 0;

async function deliver(db: Db, source: "app" | "repo", sha: string, repoId: string | null = null): Promise<{ status: string; detail: string | null }> {
  seq += 1;
  const deliveryId = `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  await db.insert(githubDelivery).values({ deliveryId, source, event: "check_suite" });
  const payload = { action: "completed", repository: { id: 42, full_name: "Org/App" }, check_suite: { head_sha: sha } };
  await handleGitHubEvent({ deliveryId, event: "check_suite", source, repoId, payload }, testDeps(db), getApi);
  const [row] = await db.select().from(githubDelivery).where(eq(githubDelivery.deliveryId, deliveryId));
  return { status: row.status, detail: row.detail };
}

/** Repo R (app mode) with `checksWarning`, and a PR link with head sha `abc` on an owned system. */
async function setup(checksWarning: boolean, mode: "app" | "webhook" = "app") {
  const db = await createTestDb();
  const p = await createProjectFixture(db, "p");
  const sys = await createSystem(db, p.owner, "p", { slug: "search-index", title: "Search index" });
  await db.update(system).set({ ownerUserId: p.owner.userId }).where(eq(system.id, sys.id));
  await db.insert(githubInstallation).values({ id: 7, accountLogin: "Org", accountType: "Organization", repositorySelection: "all" });
  await db.insert(githubRepo).values({
    id: "r1",
    projectId: p.projectId,
    fullName: "Org/App",
    fullNameKey: "org/app",
    mode,
    ...(mode === "app" ? { githubRepoId: 42, installationId: 7 } : { webhookSecretEnc: "x" }),
    createdBy: p.owner.userId,
    rules: { closeOnMerge: false, reviewOnOpen: false, checksWarning },
  });
  await db.insert(codeLink).values({
    id: "l1",
    projectId: p.projectId,
    systemId: sys.id,
    taskId: null,
    repoId: "r1",
    kind: "pr",
    refKey: "pr:419",
    targetKey: `system:${sys.id}`,
    number: 419,
    sha: "abc",
    title: "feat",
    url: "https://github.com/Org/App/pull/419",
    state: "open",
    checks: "pending",
  });
  return { db };
}

describe("check_suite events", () => {
  it("stores a failure and warns the system owner", async () => {
    const { db } = await setup(true);
    api.seed.suites["Org/App@abc"] = [done("failure")];
    expect((await deliver(db, "app", "abc")).status).toBe("done");
    const [row] = await db.select().from(codeLink);
    expect(row.checks).toBe("failure");
    const rows = await db.select().from(notification).where(eq(notification.kind, "checks.failed"));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceKey).toBe("checks-failed:r1:abc");
    await deliver(db, "app", "abc");
    expect(await db.select().from(notification).where(eq(notification.kind, "checks.failed"))).toHaveLength(1);
  });

  it("stays quiet when the warning is off", async () => {
    const { db } = await setup(false);
    api.seed.suites["Org/App@abc"] = [done("failure")];
    await deliver(db, "app", "abc");
    expect((await db.select().from(codeLink))[0].checks).toBe("failure");
    expect(await db.select().from(notification).where(eq(notification.kind, "checks.failed"))).toEqual([]);
  });

  it("ignores a sha no link has", async () => {
    const { db } = await setup(true);
    expect((await deliver(db, "app", "zzz")).status).toBe("ignored");
  });

  it("ignores a manual webhook delivery", async () => {
    const { db } = await setup(true, "webhook");
    expect((await deliver(db, "repo", "abc", "r1")).status).toBe("ignored");
  });
});
