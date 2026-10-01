import { describe, expect, it, vi } from "vitest";
import { agentCall, agentRun, apikey, authEvent } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { memoryKv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { failedToolCalls, keyUsageOverview, listAuditEvents, recordAuthEvent, recordThrottled } from "./audit";
import { ForbiddenError } from "./errors";

const NOW = new Date("2026-10-01T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** An event with only a kind and optional fields. */
const event = (kind: (typeof authEvent.$inferInsert)["kind"], extra: Partial<typeof authEvent.$inferInsert> = {}) => ({
  kind,
  userId: null,
  discordId: null,
  apiKeyId: null,
  ip: null,
  userAgent: null,
  detail: null,
  ...extra,
});

/** A tool call of run `runId`. */
const call = (runId: string, at: Date, ok: boolean) => ({
  runId,
  at,
  tool: "update_task",
  transport: "mcp" as const,
  ok,
  status: ok ? 200 : 404,
  error: ok ? null : "Unknown task #9.",
  durationMs: 5,
});

async function countEvents(db: Db) {
  return (await db.select().from(authEvent)).length;
}

describe("recordAuthEvent", () => {
  it("resolves without throwing when the database fails", async () => {
    const broken = {
      insert: () => {
        throw new Error("database is closed");
      },
    } as unknown as Executor;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(recordAuthEvent(broken, event("sign-in"))).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("writes the event", async () => {
    const db = await createTestDb();
    await recordAuthEvent(db, event("sign-in-refused", { discordId: "123" }));
    expect(await db.select().from(authEvent)).toMatchObject([{ kind: "sign-in-refused", discordId: "123" }]);
  });
});

describe("recordThrottled", () => {
  it("writes once per window and again after the throttle key is gone", async () => {
    const db = await createTestDb();
    const kv = memoryKv();
    await recordThrottled(db, kv, event("key-rejected"), "audit:rej:rmk_abcdefgh", 60);
    await recordThrottled(db, kv, event("key-rejected"), "audit:rej:rmk_abcdefgh", 60);
    expect(await countEvents(db)).toBe(1);
    await kv.del("audit:rej:rmk_abcdefgh");
    await recordThrottled(db, kv, event("key-rejected"), "audit:rej:rmk_abcdefgh", 60);
    expect(await countEvents(db)).toBe(2);
  });

  it("writes at most five rejected keys per address a minute", async () => {
    const db = await createTestDb();
    const kv = memoryKv();
    for (let i = 0; i < 10; i++) await recordThrottled(db, kv, event("key-rejected", { ip: "203.0.113.9" }), `audit:rej:rmk_bogus${i}`, 60);
    expect(await countEvents(db)).toBe(5);
    await recordThrottled(db, kv, event("key-rejected", { ip: "198.51.100.1" }), "audit:rej:rmk_other", 60);
    expect(await countEvents(db)).toBe(6);
  });
});

describe("listAuditEvents", () => {
  it("refuses non-admins", async () => {
    const db = await createTestDb();
    const user = await insertUser(db);
    await expect(listAuditEvents(db, user, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("pages newest first by id without overlap and filters by kind and user", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const user = await insertUser(db);
    for (let i = 0; i < 5; i++) await recordAuthEvent(db, event(i % 2 ? "sign-in" : "key-created", { userId: user.userId }));
    await recordAuthEvent(db, event("sign-in", { userId: admin.userId }));

    const first = await listAuditEvents(db, admin, { limit: 4 });
    expect(first.events).toHaveLength(4);
    expect(first.nextBefore).toBe(first.events[3].id);
    const ids = first.events.map((e) => e.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const second = await listAuditEvents(db, admin, { limit: 4, before: first.nextBefore! });
    expect(second.events).toHaveLength(2);
    expect(second.nextBefore).toBeNull();
    expect(second.events.every((e) => e.id < ids[3])).toBe(true);

    const keys = await listAuditEvents(db, admin, { kind: "key-created" });
    expect(keys.events.map((e) => e.kind)).toEqual(["key-created", "key-created", "key-created"]);
    const mine = await listAuditEvents(db, admin, { userId: admin.userId });
    expect(mine.events).toHaveLength(1);
    expect(mine.events[0]).toMatchObject({ userName: admin.name });
  });
});

describe("failedToolCalls", () => {
  it("lists only failed calls of the last 7 days", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const user = await insertUser(db, { name: "Sam" });
    await db.insert(agentRun).values({ id: "r1", apiKeyId: "k1", userId: user.userId, title: "Fix tasks" });
    await db.insert(agentCall).values([call("r1", daysAgo(1), false), call("r1", daysAgo(1), true), call("r1", daysAgo(8), false)]);

    await expect(failedToolCalls(db, user, {}, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await failedToolCalls(db, admin, {}, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: "r1", runTitle: "Fix tasks", userName: "Sam", tool: "update_task", error: "Unknown task #9." });
  });
});

describe("keyUsageOverview", () => {
  it("counts calls, errors and rate-limited events per key over 30 days", async () => {
    const db = await createTestDb();
    const admin = await insertUser(db, { isAdmin: true });
    const user = await insertUser(db, { name: "Sam" });
    await db.insert(apikey).values([
      { id: "k1", key: "h1", name: "laptop", referenceId: user.userId },
      { id: "k2", key: "h2", name: "ci", referenceId: user.userId },
    ]);
    await db.insert(agentRun).values({ id: "r1", apiKeyId: "k1", userId: user.userId });
    await db.insert(agentCall).values([call("r1", daysAgo(1), true), call("r1", daysAgo(2), false), call("r1", daysAgo(31), false)]);
    await db.insert(authEvent).values([
      event("key-rate-limited", { apiKeyId: "k1", at: daysAgo(1) }),
      event("key-rate-limited", { apiKeyId: "k1", at: daysAgo(3) }),
      event("key-rate-limited", { apiKeyId: "k1", at: daysAgo(40) }),
      event("key-rate-limited", { apiKeyId: "k2", at: daysAgo(1) }),
    ]);

    await expect(keyUsageOverview(db, user, NOW)).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await keyUsageOverview(db, admin, NOW);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.k1).toMatchObject({ name: "laptop", ownerName: "Sam", calls30Days: 2, errors30Days: 1, rateLimited30Days: 2 });
    expect(byId.k2).toMatchObject({ name: "ci", calls30Days: 0, errors30Days: 0, rateLimited30Days: 1 });
  });
});
