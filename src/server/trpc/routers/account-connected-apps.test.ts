import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { authEvent, oauthClient, oauthConsent } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { memoryKv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { createCallerFactory } from "../init";
import { appRouter } from "../router";

/** Keeps Better Auth out of the tests; procedures under test never reach it. */
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: {} }) }));

/** Calls the router in-process as `actor`. */
function caller(db: Db, actor: Actor) {
  return createCallerFactory(appRouter)({ db, actor, sessionId: null, kv: memoryKv() });
}

describe("account connected apps", () => {
  it("disconnects an app and records it in the audit log", async () => {
    const db = await createTestDb();
    const ada = await insertUser(db);
    const now = new Date();
    await db.insert(oauthClient).values({ id: "c1", clientId: "cli-1", name: "Claude Code", redirectUris: ["http://127.0.0.1/cb"], createdAt: now, updatedAt: now });
    await db.insert(oauthConsent).values({ id: "k1", clientId: "cli-1", userId: ada.userId, scopes: [], createdAt: now, updatedAt: now });
    expect(await caller(db, ada).account.connectedApps()).toHaveLength(1);
    await caller(db, ada).account.revokeConnectedApp({ clientId: "cli-1" });
    expect(await caller(db, ada).account.connectedApps()).toEqual([]);
    const events = await db.select().from(authEvent).where(eq(authEvent.userId, ada.userId));
    expect(events).toMatchObject([{ kind: "oauth-revoked", apiKeyId: "cli-1" }]);
  });

  it("answers an unknown app with NOT_FOUND", async () => {
    const db = await createTestDb();
    const ada = await insertUser(db);
    await expect(caller(db, ada).account.revokeConnectedApp({ clientId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
