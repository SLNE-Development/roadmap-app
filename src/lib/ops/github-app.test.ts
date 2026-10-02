import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubApp, user } from "@/db/schema";
import { fakeGitHubApi } from "@/lib/github/fake";
import { memoryKv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import {
  appHealth,
  completeManifest,
  getAppSummary,
  loadAppConfig,
  rotateWebhookSecret,
  saveAppCredentials,
  setLinkPolicy,
  startManifest,
} from "./github-app";

const KEY = "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----";

const input = {
  appId: 42,
  slug: "roadmap-app",
  name: "Roadmap App",
  ownerLogin: "SLNE-Development",
  htmlUrl: "https://github.com/apps/roadmap-app",
  clientId: "Iv1.abc",
  clientSecret: "client-secret",
  privateKey: KEY,
  webhookSecret: "hook-secret",
};

describe("github app credentials", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("stores the secrets encrypted and loads them back", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, input);
    const config = await loadAppConfig(db);
    expect(config).toMatchObject({ appId: 42, privateKey: KEY, webhookSecret: "hook-secret", clientSecret: "client-secret", linkPolicy: "owners" });
    expect(config?.previousWebhookSecret).toBeNull();
    const [row] = await db.select().from(githubApp);
    expect(row.privateKeyEnc).not.toBe(KEY);
    expect(row.privateKeyEnc).not.toContain("PRIVATE KEY");
  });

  it("clears the previous webhook secret when the credentials are saved again", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, input);
    await rotateWebhookSecret(db, fakeGitHubApi(), admin, new Date());
    expect((await loadAppConfig(db))?.previousWebhookSecret).not.toBeNull();
    await saveAppCredentials(db, admin, { ...input, appId: 43 });
    const [row] = await db.select().from(githubApp);
    expect(row.previousWebhookSecretEnc).toBeNull();
    expect(row.previousSecretExpiresAt).toBeNull();
  });

  it("returns null without a row", async () => {
    expect(await loadAppConfig(await createTestDb())).toBeNull();
  });

  it("refuses a non-admin", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await expect(saveAppCredentials(db, user, input)).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("keeps one row and the link policy on a second save", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, input);
    await db.update(githubApp).set({ linkPolicy: "admins" }).where(eq(githubApp.id, "default"));
    await saveAppCredentials(db, admin, { ...input, appId: 43 });
    expect(await db.select().from(githubApp)).toHaveLength(1);
    expect(await loadAppConfig(db)).toMatchObject({ appId: 43, linkPolicy: "admins" });
  });

  it("names the field of an invalid private key", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await expect(saveAppCredentials(db, admin, { ...input, privateKey: "hello" })).rejects.toMatchObject({
      name: "InvalidError",
      message: expect.stringContaining("privateKey"),
    });
  });

  it("summarises without secrets for admins only", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true, name: "Root" });
    const user = await insertUser(db);
    expect(await getAppSummary(db, admin)).toBeNull();
    await saveAppCredentials(db, admin, input);
    const summary = await getAppSummary(db, admin);
    expect(summary).toMatchObject({ appId: 42, slug: "roadmap-app", linkPolicy: "owners", createdByName: "Root" });
    for (const key of ["privateKey", "clientSecret", "webhookSecret"]) expect(summary).not.toHaveProperty(key);
    await expect(getAppSummary(db, user)).rejects.toMatchObject({ name: "ForbiddenError" });
  });
});

describe("github app setup", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");
  const conversion = {
    id: 77,
    slug: "roadmap-new",
    name: "Roadmap (roadmap.example.com)",
    ownerLogin: "SLNE-Development",
    htmlUrl: "https://github.com/apps/roadmap-new",
    clientId: "Iv1.new",
    clientSecret: "new-client-secret",
    webhookSecret: "new-hook-secret",
    pem: KEY,
  };

  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("BETTER_AUTH_URL", "https://roadmap.example.com");
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses to start the manifest flow when GitHub cannot reach the site", async () => {
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3001");
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const kv = memoryKv();
    await expect(startManifest(db, kv, admin, {})).rejects.toThrow(
      "GitHub can't reach http://localhost:3001. Set BETTER_AUTH_URL to a public URL (for example a tunnel) to create the app here, or use an existing app.",
    );
    await expect(startManifest(db, kv, admin, {})).rejects.toMatchObject({ name: "InvalidError" });
  });

  it("refuses to start the manifest flow for a non-admin", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await expect(startManifest(db, memoryKv(), user, {})).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("starts the manifest flow with a state mapped to the admin", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const kv = memoryKv();
    const started = await startManifest(db, kv, admin, { org: "SLNE-Development" });
    expect(started.state).toMatch(/^[0-9a-f]{64}$/);
    expect(started.action).toBe(`https://github.com/organizations/SLNE-Development/settings/apps/new?state=${started.state}`);
    expect(JSON.parse(started.manifest)).toMatchObject({ hook_attributes: { url: "https://roadmap.example.com/api/github/app" } });
    expect(await kv.get(`gh:manifest:${started.state}`)).toBe(admin.userId);
  });

  it("refuses an unknown state without storing an app", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const api = fakeGitHubApi({ conversion });
    await expect(completeManifest(db, memoryKv(), api, admin.userId, "code", "nope")).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(await db.select().from(githubApp)).toHaveLength(0);
    expect(api.calls).toHaveLength(0);
  });

  it("stores the converted app and consumes the state", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const kv = memoryKv();
    const api = fakeGitHubApi({ conversion });
    const { state } = await startManifest(db, kv, admin, {});
    await completeManifest(db, kv, api, admin.userId, "code", state);
    expect(await loadAppConfig(db)).toMatchObject({ appId: 77, slug: "roadmap-new", privateKey: KEY, webhookSecret: "new-hook-secret" });
    expect(await kv.get(`gh:manifest:${state}`)).toBeNull();
    await expect(completeManifest(db, kv, api, admin.userId, "code", state)).rejects.toMatchObject({ name: "ForbiddenError" });
  });

  it("refuses a state when the user is no longer an admin", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const kv = memoryKv();
    const api = fakeGitHubApi({ conversion });
    const { state } = await startManifest(db, kv, admin, {});
    await db.update(user).set({ isAdmin: false }).where(eq(user.id, admin.userId));
    await expect(completeManifest(db, kv, api, admin.userId, "code", state)).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(await db.select().from(githubApp)).toHaveLength(0);
    expect(api.calls).toHaveLength(0);
  });

  it("keeps the secret when GitHub refuses the rotation", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, input);
    const api = fakeGitHubApi();
    api.updateWebhookSecret = async () => {
      throw new Error("GitHub is down");
    };
    await expect(rotateWebhookSecret(db, api, admin, NOW)).rejects.toThrow("GitHub is down");
    expect(await loadAppConfig(db)).toMatchObject({ webhookSecret: "hook-secret", previousWebhookSecret: null, previousSecretExpiresAt: null });
  });

  it("keeps the old secret for ten minutes after a rotation", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, input);
    const api = fakeGitHubApi();
    await rotateWebhookSecret(db, api, admin, NOW);
    const sent = api.calls.find((c) => c.method === "updateWebhookSecret")?.args[0];
    expect(sent).toMatch(/^[0-9a-f]{64}$/);
    const config = await loadAppConfig(db);
    expect(config).toMatchObject({ webhookSecret: sent, previousWebhookSecret: "hook-secret" });
    expect(config?.previousSecretExpiresAt).toEqual(new Date(NOW.getTime() + 10 * 60_000));
  });

  it("changes the link policy", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, input);
    await setLinkPolicy(db, admin, "admins");
    expect((await getAppSummary(db, admin))?.linkPolicy).toBe("admins");
  });
});

describe("github app health", () => {
  const NOW = new Date("2026-10-01T12:00:00Z");

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports nothing missing when the app has the required permissions", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    expect(await appHealth(db, fakeGitHubApi(), admin, NOW)).toMatchObject({ missing: [], failedLast24h: 0 });
  });

  it("names the permissions and events the app lacks", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const api = fakeGitHubApi({
      appPermissions: {
        permissions: { pull_requests: "read", metadata: "read", contents: "read", checks: "read" },
        events: ["pull_request", "push", "check_suite"],
      },
    });
    expect((await appHealth(db, api, admin, NOW)).missing).toEqual(["pull_requests: write", "event issue_comment"]);
  });

  it("keeps the panel working when the permissions cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const api = fakeGitHubApi({ failWith: { getAppPermissions: 500 } });
    expect(await appHealth(db, api, admin, NOW)).toMatchObject({ missing: [], lastWebhookAt: null, failedLast24h: 0, recentErrors: [] });
  });
});
