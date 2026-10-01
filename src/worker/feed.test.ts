import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { changeLog, feedSeen } from "@/db/schema";
import type { Db } from "@/db/types";
import { memoryKv } from "@/lib/kv";
import { logChange } from "@/lib/ops/log";
import { createProjectFixture } from "@/test/fixtures";
import { createTestDb } from "@/test/db";
import { testDeps } from "./deps";
import { runFeedTick, type FeedConsumer } from "./feed";
import "./feed-prune";
import { runJob } from "./jobs";

async function setup() {
  const db = await createTestDb();
  const { owner, projectId } = await createProjectFixture(db);
  return { db, owner, projectId };
}

async function addChange(db: Db, owner: Parameters<typeof logChange>[1], projectId: string, field: string) {
  await logChange(db, owner, { projectId, entity: "system", entityId: "s", field });
}

function recorder(opts: { fromStart?: boolean } = {}) {
  const got: number[] = [];
  const consumer: FeedConsumer = {
    name: "rec",
    handle: async (evts) => {
      got.push(...evts.map((e) => e.id));
    },
    ...opts,
  };
  return { got, consumer };
}

const row = (projectId: string, id: number, createdAt: Date) => ({
  id,
  projectId,
  entity: "system",
  entityId: "s",
  field: "f",
  createdAt,
});

describe("change feed", () => {
  it("starts at the head", async () => {
    const { db, owner, projectId } = await setup();
    for (const f of ["a", "b", "c"]) await addChange(db, owner, projectId, f);
    const deps = testDeps(db);
    const { got, consumer } = recorder();
    await runFeedTick(deps, [consumer]);
    expect(got).toEqual([]);
    await addChange(db, owner, projectId, "d");
    await runFeedTick(deps, [consumer]);
    const [last] = await db.select({ id: changeLog.id }).from(changeLog).orderBy(sql`id desc`).limit(1);
    expect(got).toEqual([last.id]);
  });

  it("fromStart replays", async () => {
    const { db, owner, projectId } = await setup();
    for (const f of ["a", "b", "c"]) await addChange(db, owner, projectId, f);
    const { got, consumer } = recorder({ fromStart: true });
    await runFeedTick(testDeps(db), [consumer]);
    expect(got).toEqual((await db.select({ id: changeLog.id }).from(changeLog).orderBy(changeLog.id)).map((r) => r.id));
    expect(got.length).toBeGreaterThanOrEqual(3);
    expect(got).toEqual([...got].sort((a, b) => a - b));
  });

  it("resumes from its cursor after a restart", async () => {
    const { db, owner, projectId } = await setup();
    const { got, consumer } = recorder();
    await runFeedTick(testDeps(db), [consumer]);
    await addChange(db, owner, projectId, "a");
    await addChange(db, owner, projectId, "b");
    await runFeedTick(testDeps(db), [consumer]);
    expect(got).toHaveLength(2);
    got.length = 0;
    await runFeedTick(testDeps(db, { kv: memoryKv() }), [consumer]);
    expect(got).toEqual([]);
    await addChange(db, owner, projectId, "c");
    await runFeedTick(testDeps(db, { kv: memoryKv() }), [consumer]);
    expect(got).toHaveLength(1);
  });

  it("does not redeliver after the Kv is replaced", async () => {
    const { db, owner, projectId } = await setup();
    for (const f of ["a", "b", "c"]) await addChange(db, owner, projectId, f);
    const { got, consumer } = recorder({ fromStart: true });
    await runFeedTick(testDeps(db), [consumer]);
    const delivered = got.length;
    expect(delivered).toBeGreaterThanOrEqual(3);
    await runFeedTick(testDeps(db, { kv: memoryKv() }), [consumer]);
    expect(got).toHaveLength(delivered);
  });

  it("delivers a late lower id once", async () => {
    const { db, projectId } = await setup();
    const deps = testDeps(db);
    const { got, consumer } = recorder();
    await runFeedTick(deps, [consumer]);
    await db.insert(changeLog).values(row(projectId, 100, new Date()));
    await runFeedTick(deps, [consumer]);
    expect(got).toEqual([100]);
    got.length = 0;
    await db.insert(changeLog).values(row(projectId, 95, new Date()));
    await runFeedTick(deps, [consumer]);
    expect(got).toEqual([95]);
    got.length = 0;
    await runFeedTick(deps, [consumer]);
    expect(got).toEqual([]);
    await db.insert(changeLog).values(row(projectId, 50, new Date(Date.now() - 10 * 60_000)));
    await runFeedTick(deps, [consumer]);
    expect(got).toEqual([]);
  });

  it("batches in id order", async () => {
    const { db, projectId } = await setup();
    await db.delete(changeLog);
    await db.insert(changeLog).values(Array.from({ length: 450 }, (_, i) => row(projectId, i + 1, new Date())));
    const batches: number[][] = [];
    const consumer: FeedConsumer = {
      name: "rec",
      fromStart: true,
      handle: async (evts) => {
        batches.push(evts.map((e) => e.id));
      },
    };
    const deps = testDeps(db);
    for (let i = 0; i < 3; i++) await runFeedTick(deps, [consumer], { batchSize: 200 });
    expect(batches.map((b) => b.length)).toEqual([200, 200, 50]);
    const all = batches.flat();
    expect(all.every((id, i) => i === 0 || id > all[i - 1])).toBe(true);
  });

  it("isolates a failing consumer", async () => {
    const { db, owner, projectId } = await setup();
    const deps = testDeps(db);
    let aCalls = 0;
    const aGot: number[] = [];
    const a: FeedConsumer = {
      name: "a",
      handle: async (evts) => {
        aCalls += 1;
        if (aCalls === 1) throw new Error("boom");
        aGot.push(...evts.map((e) => e.id));
      },
    };
    const b = recorder();
    b.consumer.name = "b";
    await runFeedTick(deps, [a, b.consumer]);
    await addChange(db, owner, projectId, "x");
    const r1 = await runFeedTick(deps, [a, b.consumer]);
    expect(r1?.find((r) => r.consumer === "a")?.error).toBe("boom");
    expect(b.got).toHaveLength(1);
    const r2 = await runFeedTick(deps, [a, b.consumer]);
    expect(r2?.find((r) => r.consumer === "a")?.error).toBeUndefined();
    expect(aGot).toEqual(b.got);
    expect(b.got).toHaveLength(1);
  });

  it("only the lease holder delivers", async () => {
    const { db, owner, projectId } = await setup();
    let clock = 1_000_000;
    const deps = testDeps(db, { kv: memoryKv(() => clock) });
    const { got, consumer } = recorder();
    await runFeedTick(deps, [consumer], { holder: "h1" });
    await addChange(db, owner, projectId, "a");
    await runFeedTick(deps, [consumer], { holder: "h1" });
    expect(got).toHaveLength(1);
    expect(await runFeedTick(deps, [consumer], { holder: "h2" })).toBeNull();
    expect(got).toHaveLength(1);
    clock += 11_000;
    await addChange(db, owner, projectId, "b");
    expect(await runFeedTick(deps, [consumer], { holder: "h2" })).not.toBeNull();
    expect(got).toHaveLength(2);
  });

  it("feed-prune removes old seen rows", async () => {
    const { db } = await setup();
    await db.insert(feedSeen).values([
      { consumer: "rec", changeId: 1, seenAt: new Date(Date.now() - 20 * 60_000) },
      { consumer: "rec", changeId: 2, seenAt: new Date() },
    ]);
    await runJob("maintenance", "feed-prune", {}, testDeps(db));
    const rows = await db.select().from(feedSeen).where(eq(feedSeen.consumer, "rec"));
    expect(rows.map((r) => r.changeId)).toEqual([2]);
  });
});
