import { describe, expect, it } from "vitest";
import { apikey } from "@/db/schema";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { createApiKeyInput, listApiKeys, revokeApiKey } from "./api-keys";

describe("api keys", () => {
  it("lists only the actor's own keys, newest first, without the hash", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    await db.insert(apikey).values([
      { id: "k1", key: "h1", name: "laptop", start: "rmk_ab", referenceId: alex.userId, createdAt: new Date(1000) },
      { id: "k2", key: "h2", name: "ci", start: "rmk_cd", referenceId: alex.userId, createdAt: new Date(2000) },
      { id: "k3", key: "h3", name: "other", referenceId: sam.userId },
    ]);
    const keys = await listApiKeys(db, alex);
    expect(keys.map((k) => k.id)).toEqual(["k2", "k1"]);
    expect(keys[0]).not.toHaveProperty("key");
  });

  it("revokes the actor's key and hides other users' keys", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    await db.insert(apikey).values({ id: "k3", key: "h3", referenceId: sam.userId });
    await expect(revokeApiKey(db, alex, "k3")).rejects.toThrow("Unknown API key k3.");
    await revokeApiKey(db, sam, "k3");
    expect(await db.select().from(apikey)).toEqual([]);
  });

  it("validates new key input", () => {
    expect(createApiKeyInput.safeParse({ name: "", expiresInDays: null }).success).toBe(false);
    expect(createApiKeyInput.safeParse({ name: "x".repeat(33), expiresInDays: null }).success).toBe(false);
    expect(createApiKeyInput.safeParse({ name: "laptop", expiresInDays: 400 }).success).toBe(false);
    expect(createApiKeyInput.parse({ name: " laptop ", expiresInDays: 30 })).toEqual({ name: "laptop", expiresInDays: 30 });
  });
});
