import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubApp } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { getAppSummary, loadAppConfig, saveAppCredentials } from "./github-app";

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
