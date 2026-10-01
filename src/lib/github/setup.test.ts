import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubInstallation, githubInstallRequest } from "@/db/schema";
import type { Db } from "@/db/types";
import { memoryKv, type Kv } from "@/lib/kv";
import type { Actor } from "@/lib/ops/actor";
import { recordInstallation, saveAppCredentials, startInstall } from "@/lib/ops/github-app";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { fakeGitHubApi } from "./fake";

const appInput = {
  appId: 42,
  slug: "roadmap-app",
  name: "Roadmap App",
  ownerLogin: "SLNE-Development",
  htmlUrl: "https://github.com/apps/roadmap-app",
  clientId: "Iv1.abc",
  clientSecret: "client-secret",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
  webhookSecret: "whsec",
};

const org = { id: 5, accountLogin: "SLNE-Development", accountType: "Organization" as const, repositorySelection: "selected" as const, suspended: false };

/** A database with the App configured, an admin, a memory Kv and a fake that knows installation 5. */
async function setup(): Promise<{ db: Db; kv: Kv; admin: Actor; api: ReturnType<typeof fakeGitHubApi> }> {
  const db = await createTestDb();
  const admin = await insertUser(db, { isAdmin: true });
  await saveAppCredentials(db, admin, appInput);
  const repos = [
    { id: 11, fullName: "SLNE-Development/surf", ownerLogin: "SLNE-Development", private: true },
    { id: 12, fullName: "SLNE-Development/roadmap", ownerLogin: "SLNE-Development", private: false },
  ];
  return { db, kv: memoryKv(), admin, api: fakeGitHubApi({ installations: [org], repos: { 5: repos } }) };
}

describe("recordInstallation", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stores the installation from GitHub's data", async () => {
    const { db, kv, admin, api } = await setup();
    await kv.set("gh:repos:5", "[]");
    const to = await recordInstallation(db, kv, api, admin.userId, { installationId: 5, setupAction: "install", state: null });
    expect(to).toBe("/admin/github");
    const rows = await db.select().from(githubInstallation);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 5, accountLogin: "SLNE-Development", accountType: "Organization", repositorySelection: "selected", status: "active", installedByUserId: admin.userId });
    expect(rows[0].repoCount).toBe(2);
    expect(JSON.parse((await kv.get("gh:repos:5")) ?? "null")).toHaveLength(2);
  });

  it("keeps the repo count when GitHub cannot list the repos", async () => {
    const { db, kv, admin, api } = await setup();
    await recordInstallation(db, kv, api, admin.userId, { installationId: 5, setupAction: "install", state: null });
    api.listInstallationRepos = async () => {
      throw new Error("GitHub is down");
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await kv.set("gh:repos:5", "[]");
    expect(await recordInstallation(db, kv, api, admin.userId, { installationId: 5, setupAction: "update", state: null })).toBe("/admin/github");
    const [row] = await db.select().from(githubInstallation);
    expect(row.repoCount).toBe(2);
    expect(await kv.get("gh:repos:5")).toBeNull();
    expect(logged).toHaveBeenCalled();
  });

  it("keeps the first installer on an update", async () => {
    const { db, kv, admin, api } = await setup();
    const other = await insertUser(db);
    await recordInstallation(db, kv, api, admin.userId, { installationId: 5, setupAction: "install", state: null });
    api.seed.installations = [{ ...org, repositorySelection: "all" }];
    await recordInstallation(db, kv, api, other.userId, { installationId: 5, setupAction: "update", state: null });
    const [row] = await db.select().from(githubInstallation);
    expect(row).toMatchObject({ repositorySelection: "all", installedByUserId: admin.userId });
  });

  it("returns to the path the install was started from", async () => {
    const { db, kv, admin, api } = await setup();
    const { url } = await startInstall(db, kv, admin, { returnTo: "/p/demo/settings/github" });
    const state = new URL(url).searchParams.get("state");
    expect(url).toBe(`https://github.com/apps/roadmap-app/installations/new?state=${state}`);
    const to = await recordInstallation(db, kv, api, admin.userId, { installationId: 5, setupAction: "install", state });
    expect(to).toBe("/p/demo/settings/github");
  });

  it("refuses an installation GitHub does not know", async () => {
    const { db, kv, admin, api } = await setup();
    const to = await recordInstallation(db, kv, api, admin.userId, { installationId: 6, setupAction: "install", state: null });
    expect(to).toBe("/admin/github?error=installation");
    expect(await db.select().from(githubInstallation)).toHaveLength(0);
  });

  it("records an install request", async () => {
    const { db, kv, admin, api } = await setup();
    const to = await recordInstallation(db, kv, api, admin.userId, { installationId: null, setupAction: "request", state: null });
    expect(to.endsWith("requested=1")).toBe(true);
    const rows = await db.select().from(githubInstallRequest);
    expect(rows).toHaveLength(1);
    expect(rows[0].requestedByUserId).toBe(admin.userId);
  });

  it("records one open install request per user a day", async () => {
    const { db, kv, admin, api } = await setup();
    const other = await insertUser(db);
    const request = { installationId: null, setupAction: "request", state: null };
    await recordInstallation(db, kv, api, admin.userId, request);
    expect(await recordInstallation(db, kv, api, admin.userId, request)).toBe("/admin/github?requested=1");
    await recordInstallation(db, kv, api, other.userId, request);
    expect(await db.select().from(githubInstallRequest)).toHaveLength(2);
  });

  it("replaces an unsafe returnTo", async () => {
    const { db, kv, admin, api } = await setup();
    const { url } = await startInstall(db, kv, admin, { returnTo: "//evil.com" });
    const state = new URL(url).searchParams.get("state");
    const to = await recordInstallation(db, kv, api, admin.userId, { installationId: 5, setupAction: "install", state });
    expect(to).toBe("/admin/github");
  });

  it("ignores the install state of another user", async () => {
    const { db, kv, admin, api } = await setup();
    const other = await insertUser(db);
    const { url } = await startInstall(db, kv, other, { returnTo: "/p/demo/settings/github" });
    const state = new URL(url).searchParams.get("state");
    const to = await recordInstallation(db, kv, api, admin.userId, { installationId: 5, setupAction: "install", state });
    expect(to).toBe("/admin/github");
  });

  it("needs the app to start an install", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await expect(startInstall(db, memoryKv(), user, {})).rejects.toMatchObject({ name: "ConflictError" });
  });
});
