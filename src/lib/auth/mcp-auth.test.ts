import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { allowedAccount, oauthClient, oauthConsent, user } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { oauthCredential } from "./mcp-auth";

/** Registers a client and records the user's consent to it. */
async function consent(db: Db, userId: string, clientId: string): Promise<void> {
  await db.insert(oauthClient).values({ id: `c-${clientId}`, clientId, redirectUris: ["http://127.0.0.1/cb"], createdAt: new Date(), updatedAt: new Date() });
  await db.insert(oauthConsent).values({ id: `k-${clientId}`, clientId, userId, scopes: [], createdAt: new Date(), updatedAt: new Date() });
}

describe("oauthCredential", () => {
  let db: Db;
  let owner: Actor;

  beforeEach(async () => {
    db = await createTestDb();
    owner = await insertUser(db, { name: "Ada" });
  });

  it("resolves a consented client's token to its user, with a per-user, per-client credential id", async () => {
    await consent(db, owner.userId, "cli-1");
    expect(await oauthCredential(db, { sub: owner.userId, client_id: "cli-1" })).toEqual({
      actor: owner,
      credentialId: `oauth:${owner.userId}:cli-1`,
    });
  });

  it("falls back to azp when the token carries no client_id", async () => {
    await consent(db, owner.userId, "cli-1");
    expect((await oauthCredential(db, { sub: owner.userId, azp: "cli-1" }))?.credentialId).toBe(`oauth:${owner.userId}:cli-1`);
  });

  it("refuses a token whose consent was revoked", async () => {
    await consent(db, owner.userId, "cli-1");
    await db.delete(oauthConsent).where(eq(oauthConsent.clientId, "cli-1"));
    expect(await oauthCredential(db, { sub: owner.userId, client_id: "cli-1" })).toBeNull();
  });

  it("refuses a token whose consent belongs to another user", async () => {
    const other = await insertUser(db);
    await consent(db, other.userId, "cli-1");
    expect(await oauthCredential(db, { sub: owner.userId, client_id: "cli-1" })).toBeNull();
  });

  it("refuses a user removed from the allowlist", async () => {
    await consent(db, owner.userId, "cli-1");
    const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, owner.userId));
    await db.delete(allowedAccount).where(eq(allowedAccount.discordId, row.discordId!));
    expect(await oauthCredential(db, { sub: owner.userId, client_id: "cli-1" })).toBeNull();
  });

  it("refuses claims without a subject or client", async () => {
    expect(await oauthCredential(db, { client_id: "cli-1" })).toBeNull();
    expect(await oauthCredential(db, { sub: owner.userId })).toBeNull();
  });
});
