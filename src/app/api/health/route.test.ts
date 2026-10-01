import { describe, expect, it } from "vitest";
import { HEARTBEAT_KEY } from "@/worker/heartbeat";
import { memoryKv } from "@/lib/kv";
import { createTestDb } from "@/test/db";
import type { Db } from "@/db/types";
import { healthReport } from "./route";

const NOW = new Date("2026-10-01T12:00:00.000Z");

/** Builds health dependencies; the heartbeat is `ageSeconds` old when given. */
async function deps(opts: { valkey: boolean; ageSeconds?: number; db?: Db }) {
  const kv = memoryKv();
  if (opts.ageSeconds !== undefined) await kv.set(HEARTBEAT_KEY, new Date(NOW.getTime() - opts.ageSeconds * 1000).toISOString());
  return { db: opts.db ?? (await createTestDb()), ping: async () => opts.valkey, kv, now: () => NOW };
}

describe("healthReport", () => {
  it("reports an unknown worker while valkey is down", async () => {
    expect(await healthReport(await deps({ valkey: false }))).toEqual({
      ok: true,
      db: "up",
      valkey: "down",
      worker: "unknown",
    });
  });

  it("reports the worker up for a fresh heartbeat", async () => {
    expect((await healthReport(await deps({ valkey: true, ageSeconds: 10 }))).worker).toBe("up");
  });

  it("reports the worker stale for an old or missing heartbeat", async () => {
    expect((await healthReport(await deps({ valkey: true, ageSeconds: 40 }))).worker).toBe("stale");
    expect((await healthReport(await deps({ valkey: true }))).worker).toBe("stale");
  });

  it("is not ok when the database fails", async () => {
    const db = { execute: async () => Promise.reject(new Error("down")) } as unknown as Db;
    expect(await healthReport(await deps({ valkey: true, db }))).toMatchObject({ ok: false, db: "down" });
  });
});
