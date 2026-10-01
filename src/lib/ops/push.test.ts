import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pushSubscription } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { memoryQueue } from "@/lib/queue";
import { createTestDb } from "@/test/db";
import { createProjectFixture, insertUser } from "@/test/fixtures";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { listDevices, sendTestPush, subscribePush, unsubscribePush } from "./push";

let db: Db;
let owner: Actor;
let other: Actor;

beforeEach(async () => {
  db = await createTestDb();
  ({ owner } = await createProjectFixture(db));
  other = await insertUser(db, { name: "Other" });
});

const input = (extra: { endpoint?: string; label?: string } = {}) => ({
  endpoint: extra.endpoint ?? "https://push.example.com/send/abc",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
  label: extra.label ?? "Chrome on Windows",
});

describe("subscribePush", () => {
  it("leaves one row when the same endpoint subscribes twice", async () => {
    await subscribePush(db, owner, input());
    await subscribePush(db, owner, input({ label: "Chrome on Linux" }));
    const rows = await db.select().from(pushSubscription);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: owner.userId, label: "Chrome on Linux" });
  });

  it("keeps the id and push history when the same user subscribes again", async () => {
    const first = await subscribePush(db, owner, input());
    const at = new Date("2026-10-01T10:00:00Z");
    await db.update(pushSubscription).set({ lastSuccessAt: at });
    const second = await subscribePush(db, owner, input());
    expect(second.id).toBe(first.id);
    const [row] = await db.select().from(pushSubscription);
    expect(row.lastSuccessAt).toEqual(at);
  });

  it("hands the row to a second user subscribing with the same endpoint, under a new id", async () => {
    const first = await subscribePush(db, owner, input());
    await db.update(pushSubscription).set({ lastSuccessAt: new Date("2026-10-01T10:00:00Z"), failures: 3 });
    const second = await subscribePush(db, other, input());
    expect(second.id).not.toBe(first.id);
    const rows = await db.select().from(pushSubscription);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: second.id, userId: other.userId, lastSuccessAt: null, failures: 0 });
    expect(await listDevices(db, owner)).toEqual([]);
    expect(await listDevices(db, other)).toHaveLength(1);
  });

  it("refuses an endpoint that is not https", async () => {
    await expect(subscribePush(db, owner, input({ endpoint: "http://push.example.com/send/abc" }))).rejects.toBeInstanceOf(InvalidError);
  });
});

describe("unsubscribePush", () => {
  it("removes the actor's own device", async () => {
    const { id } = await subscribePush(db, owner, input());
    await unsubscribePush(db, owner, id);
    expect(await db.select().from(pushSubscription)).toHaveLength(0);
  });

  it("leaves another user's device", async () => {
    const { id } = await subscribePush(db, owner, input());
    await expect(unsubscribePush(db, other, id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await db.select().from(pushSubscription)).toHaveLength(1);
  });
});

describe("listDevices", () => {
  it("lists the actor's devices without their keys", async () => {
    await subscribePush(db, owner, input());
    const [device] = await listDevices(db, owner);
    expect(Object.keys(device).sort()).toEqual(["createdAt", "id", "label", "lastSuccessAt"]);
    expect(device).toMatchObject({ label: "Chrome on Windows", lastSuccessAt: null });
  });
});

describe("sendTestPush", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("queues one push.test per device and minute", async () => {
    const { id } = await subscribePush(db, owner, input());
    const queue = memoryQueue();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T10:00:05Z"));
    await sendTestPush(db, owner, id, queue);
    vi.setSystemTime(new Date("2026-10-01T10:00:40Z"));
    await sendTestPush(db, owner, id, queue);
    const minute = Math.floor(Date.parse("2026-10-01T10:00:05Z") / 60_000);
    expect(queue.jobs).toEqual([{ jobName: "push.test", data: { subscriptionId: id }, opts: { jobId: `push-test-${id}-${minute}` } }]);
  });

  it("refuses another user's device", async () => {
    const { id } = await subscribePush(db, owner, input());
    const queue = memoryQueue();
    await expect(sendTestPush(db, other, id, queue)).rejects.toBeInstanceOf(NotFoundError);
    expect(queue.jobs).toEqual([]);
  });

  it("reports a clear error when the job queue is unreachable", async () => {
    const { id } = await subscribePush(db, owner, input());
    const down = { add: () => Promise.reject(new Error("Connection is closed.")) };
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendTestPush(db, owner, id, down)).rejects.toBeInstanceOf(ConflictError);
  });
});
