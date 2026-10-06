import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { agentRun, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { NotFoundError } from "./errors";
import { listConnectedApps, revokeConnectedApp } from "./oauth-apps";

const T0 = new Date("2026-10-01T10:00:00Z");

/** Registers a client named `name` and records `userId`'s consent with a refresh and an access token. */
async function connect(db: Db, userId: string, clientId: string, name: string | null): Promise<void> {
  await db.insert(oauthClient).values({ id: `c-${clientId}`, clientId, name, redirectUris: ["http://127.0.0.1/cb"], createdAt: T0, updatedAt: T0 }).onConflictDoNothing();
  await db.insert(oauthConsent).values({ id: `k-${clientId}-${userId}`, clientId, userId, scopes: [], createdAt: T0, updatedAt: T0 });
  await db.insert(oauthRefreshToken).values({ id: `r-${clientId}-${userId}`, token: `rt-${clientId}-${userId}`, clientId, userId, scopes: [], expiresAt: new Date("2027-01-01"), createdAt: T0 });
  await db.insert(oauthAccessToken).values({ id: `a-${clientId}-${userId}`, token: `at-${clientId}-${userId}`, clientId, userId, refreshId: `r-${clientId}-${userId}`, scopes: [], expiresAt: new Date("2027-01-01"), createdAt: T0 });
}

describe("connected apps", () => {
  let db: Db;
  let ada: Actor;
  let bob: Actor;

  beforeEach(async () => {
    db = await createTestDb();
    ada = await insertUser(db, { name: "Ada" });
    bob = await insertUser(db, { name: "Bob" });
  });

  it("lists the actor's consents with the client's name and the last MCP call", async () => {
    await connect(db, ada.userId, "cli-1", "Claude Code");
    await connect(db, ada.userId, "https://claude.ai/oauth/mcp-client.json", null);
    await connect(db, bob.userId, "cli-1", "Claude Code");
    const last = new Date("2026-10-05T08:00:00Z");
    await db.insert(agentRun).values({ id: "run1", apiKeyId: `oauth:${ada.userId}:cli-1`, userId: ada.userId, startedAt: T0, lastCallAt: last });
    const apps = await listConnectedApps(db, ada);
    expect(apps).toEqual(
      expect.arrayContaining([
        { clientId: "cli-1", name: "Claude Code", grantedAt: T0, lastUsedAt: last },
        { clientId: "https://claude.ai/oauth/mcp-client.json", name: "claude.ai", grantedAt: T0, lastUsedAt: null },
      ]),
    );
    expect(apps).toHaveLength(2);
  });

  it("revokes the consent and tokens of one client for the actor only", async () => {
    await connect(db, ada.userId, "cli-1", "Claude Code");
    await connect(db, bob.userId, "cli-1", "Claude Code");
    await revokeConnectedApp(db, ada, "cli-1");
    expect(await listConnectedApps(db, ada)).toEqual([]);
    expect(await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, ada.userId))).toEqual([]);
    expect(await db.select().from(oauthAccessToken).where(eq(oauthAccessToken.userId, ada.userId))).toEqual([]);
    expect(await listConnectedApps(db, bob)).toHaveLength(1);
    expect(await db.select().from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, bob.userId))).toHaveLength(1);
  });

  it("refuses to revoke a client the actor never connected", async () => {
    await connect(db, bob.userId, "cli-1", "Claude Code");
    await expect(revokeConnectedApp(db, ada, "cli-1")).rejects.toBeInstanceOf(NotFoundError);
    expect(await listConnectedApps(db, bob)).toHaveLength(1);
  });
});
