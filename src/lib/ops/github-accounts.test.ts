import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubAccount } from "@/db/schema";
import type { Db } from "@/db/types";
import { fakeGitHubApi } from "@/lib/github/fake";
import { memoryKv, type Kv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError } from "./errors";
import { cancelGitHubLink, completeGitHubLink, myGitHubAccount, startGitHubLink, unlinkGitHub } from "./github-accounts";
import { saveAppCredentials } from "./github-app";

const credentials = {
  appId: 42,
  slug: "roadmap-app",
  name: "Roadmap App",
  ownerLogin: "SLNE-Development",
  htmlUrl: "https://github.com/apps/roadmap-app",
  clientId: "Iv1.abc",
  clientSecret: "client-secret",
  privateKey: "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----",
  webhookSecret: "hook-secret",
};

/** Starts a link for the actor and returns the state from the authorize URL. */
async function begin(db: Db, kv: Kv, actor: Actor): Promise<string> {
  const { url } = await startGitHubLink(db, kv, actor);
  return new URL(url).searchParams.get("state")!;
}

describe("github accounts", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses to start without an app", async () => {
    const db = await createTestDb();
    const rik = await insertUser(db);
    await expect(startGitHubLink(db, memoryKv(), rik)).rejects.toBeInstanceOf(ConflictError);
  });

  it("builds the authorize url and stores the state for ten minutes", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, credentials);
    let now = 0;
    const kv = memoryKv(() => now);
    const { url } = await startGitHubLink(db, kv, admin);
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("Iv1.abc");
    expect(u.searchParams.get("allow_signup")).toBe("false");
    const state = u.searchParams.get("state")!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(await kv.get(`gh:oauth:${state}`)).toBe(admin.userId);
    now = 601_000;
    expect(await kv.get(`gh:oauth:${state}`)).toBeNull();
  });

  it("links, conflicts, relinks and unlinks", async () => {
    const db = await createTestDb();
    const kv = memoryKv();
    const rik = await insertUser(db, { isAdmin: true });
    const mia = await insertUser(db);
    await saveAppCredentials(db, rik, credentials);
    const api = fakeGitHubApi({ oauthUser: { id: 500, login: "rik-dev" } });

    await completeGitHubLink(db, kv, api, rik.userId, "code", await begin(db, kv, rik));
    expect(await myGitHubAccount(db, rik)).toMatchObject({ login: "rik-dev" });

    await expect(completeGitHubLink(db, kv, api, mia.userId, "code", await begin(db, kv, mia))).rejects.toThrow(
      new ConflictError("That GitHub account is linked to another person."),
    );
    expect(await myGitHubAccount(db, mia)).toBeNull();

    const renamed = fakeGitHubApi({ oauthUser: { id: 500, login: "rik" } });
    await completeGitHubLink(db, kv, renamed, rik.userId, "code", await begin(db, kv, rik));
    expect((await myGitHubAccount(db, rik))?.login).toBe("rik");
    expect(await db.select().from(githubAccount)).toHaveLength(1);

    await unlinkGitHub(db, rik);
    expect(await db.select().from(githubAccount).where(eq(githubAccount.userId, rik.userId))).toHaveLength(0);
    expect(await myGitHubAccount(db, rik)).toBeNull();
  });

  it("drops an abandoned state", async () => {
    const db = await createTestDb();
    const kv = memoryKv();
    const admin = await insertUser(db, { isAdmin: true });
    await saveAppCredentials(db, admin, credentials);
    const state = await begin(db, kv, admin);
    await cancelGitHubLink(kv, state);
    expect(await kv.get(`gh:oauth:${state}`)).toBeNull();
    await cancelGitHubLink(kv, null);
  });

  it("rejects an unknown, reused or foreign state without a row", async () => {
    const db = await createTestDb();
    const kv = memoryKv();
    const rik = await insertUser(db, { isAdmin: true });
    const mia = await insertUser(db);
    await saveAppCredentials(db, rik, credentials);
    const api = fakeGitHubApi({ oauthUser: { id: 500, login: "rik-dev" } });

    await expect(completeGitHubLink(db, kv, api, rik.userId, "code", "nope")).rejects.toBeInstanceOf(ForbiddenError);
    const foreign = await begin(db, kv, mia);
    await expect(completeGitHubLink(db, kv, api, rik.userId, "code", foreign)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await kv.get(`gh:oauth:${foreign}`)).toBeNull();
    const state = await begin(db, kv, rik);
    await completeGitHubLink(db, kv, api, rik.userId, "code", state);
    await expect(completeGitHubLink(db, kv, api, rik.userId, "code", state)).rejects.toBeInstanceOf(ForbiddenError);
    await unlinkGitHub(db, rik);
    await expect(completeGitHubLink(db, kv, api, rik.userId, "code", "nope")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.select().from(githubAccount)).toHaveLength(0);
  });
});
