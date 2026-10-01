import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { agentCall, agentRun, apikey } from "@/db/schema";
import type { Db } from "@/db/types";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { createApiKeyInput, listApiKeys, revokeApiKey, rotateApiKey } from "./api-keys";
import { ConflictError, NotFoundError } from "./errors";

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

describe("api key usage", () => {
  it("counts calls per UTC day over the last 7 days and totals the last 30", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const now = new Date("2026-10-01T12:00:00Z");
    const day = (n: number) => new Date(now.getTime() + n * 86_400_000);
    await db.insert(apikey).values([
      { id: "k1", key: "h1", referenceId: alex.userId },
      { id: "k2", key: "h2", referenceId: alex.userId },
    ]);
    await db.insert(agentRun).values({ id: "r1", apiKeyId: "k1", userId: alex.userId });
    const call = (at: Date, ok = true) => ({ runId: "r1", at, tool: "t", transport: "mcp" as const, ok, status: ok ? 200 : 500, durationMs: 1 });
    await db.insert(agentCall).values([call(day(-1)), call(day(-1), false), call(day(-3)), call(day(-20)), call(day(-40))]);
    const keys = await listApiKeys(db, alex, now);
    expect(keys.find((k) => k.id === "k1")?.usage).toEqual({ last7Days: [0, 0, 0, 1, 0, 2, 0], total30Days: 4, errors30Days: 1 });
    expect(keys.find((k) => k.id === "k2")?.usage).toEqual({ last7Days: [0, 0, 0, 0, 0, 0, 0], total30Days: 0, errors30Days: 0 });
  });
});

describe("rotateApiKey", () => {
  const now = new Date("2026-10-01T12:00:00Z");

  /** A fake `create` that inserts the new key row like Better Auth would. */
  function fakeCreate(db: Db, userId: string) {
    const calls: { name: string | undefined; expiresIn: number | null; userId: string }[] = [];
    const create = async (body: { name: string | undefined; expiresIn: number | null; userId: string }) => {
      calls.push(body);
      await db.insert(apikey).values({ id: "new", key: "hn", name: body.name, referenceId: userId });
      return { key: "rmk_secret", id: "new" };
    };
    return { create, calls };
  }

  const row = async (db: Db, id: string) => (await db.select().from(apikey).where(eq(apikey.id, id)))[0]!;

  it("gives the old key a 24 hour grace, links both keys and returns the new key", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    await db.insert(apikey).values({ id: "old", key: "ho", name: "laptop", referenceId: alex.userId });
    const { create, calls } = fakeCreate(db, alex.userId);
    expect(await rotateApiKey(db, alex, "old", create, now)).toEqual({ key: "rmk_secret" });
    expect(calls).toEqual([{ name: "laptop", expiresIn: null, userId: alex.userId }]);
    const old = await row(db, "old");
    expect(Math.abs(old.expiresAt!.getTime() - (now.getTime() + 86_400_000))).toBeLessThan(60_000);
    expect(JSON.parse(old.metadata!)).toEqual({ rotatedTo: "new", graceUntil: old.expiresAt!.toISOString() });
    expect(JSON.parse((await row(db, "new")).metadata!)).toEqual({ rotatedFrom: "old" });
    const listed = await listApiKeys(db, alex, now);
    expect(listed.find((k) => k.id === "new")?.rotatedFrom).toBe("old");
    expect(listed.find((k) => k.id === "old")?.graceUntil).toEqual(old.expiresAt);
  });

  it("keeps the lifetime length of an expiring key", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const createdAt = new Date(now.getTime() - 5 * 86_400_000);
    await db.insert(apikey).values({ id: "old", key: "ho", name: "ci", referenceId: alex.userId, createdAt, expiresAt: new Date(createdAt.getTime() + 30 * 86_400_000) });
    const { create, calls } = fakeCreate(db, alex.userId);
    await rotateApiKey(db, alex, "old", create, now);
    expect(calls[0]?.expiresIn).toBe(30 * 86_400);
  });

  it("keeps an earlier expiry of the old key", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const soon = new Date(now.getTime() + 3_600_000);
    await db.insert(apikey).values({ id: "old", key: "ho", referenceId: alex.userId, expiresAt: soon });
    const { create } = fakeCreate(db, alex.userId);
    await rotateApiKey(db, alex, "old", create, now);
    expect((await row(db, "old")).expiresAt).toEqual(soon);
  });

  it("refuses to rotate a key that is already in its grace period", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    await db.insert(apikey).values({ id: "old", key: "ho", referenceId: alex.userId });
    const { create, calls } = fakeCreate(db, alex.userId);
    await rotateApiKey(db, alex, "old", create, now);
    await expect(rotateApiKey(db, alex, "old", create, now)).rejects.toBeInstanceOf(ConflictError);
    expect(calls).toHaveLength(1);
  });

  it("hides other users' keys", async () => {
    const db = await createTestDb();
    const alex = await insertUser(db);
    const sam = await insertUser(db);
    await db.insert(apikey).values({ id: "old", key: "ho", referenceId: sam.userId });
    const { create, calls } = fakeCreate(db, alex.userId);
    await expect(rotateApiKey(db, alex, "old", create, now)).rejects.toBeInstanceOf(NotFoundError);
    expect(calls).toEqual([]);
  });
});
