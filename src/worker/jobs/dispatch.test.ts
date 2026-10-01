import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notification } from "@/db/schema";
import type { Db } from "@/db/types";
import { newId } from "@/lib/id";
import { activeKey, NOTIFY_RULES_PREF } from "@/lib/notify-rules-schema";
import type { Actor } from "@/lib/ops/actor";
import { removeMember } from "@/lib/ops/members";
import { notify } from "@/lib/ops/notifications";
import { setPref } from "@/lib/ops/prefs";
import { subscribePush } from "@/lib/ops/push";
import type { NotificationKind } from "@/lib/notification-kinds";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { testDeps } from "../deps";
import { registeredJobs, registeredRepeatables, runJob } from "../jobs";
import "./dispatch";
import { dispatchPushes } from "./dispatch";

const NOW = new Date("2026-10-01T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

let db: Db;
let owner: Actor;
let editor: Actor;
let projectId: string;

beforeEach(async () => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
  db = await createTestDb();
  ({ owner, projectId } = await createProjectFixture(db));
  editor = await addMemberFixture(db, owner, "demo", "editor", "Edi");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Notifies the editor about `kind`, created `ago` minutes before NOW, and returns the row id. */
async function pending(kind: NotificationKind = "mention", ago = 1): Promise<string> {
  await notify(db, {
    userId: editor.userId,
    projectId,
    kind,
    entity: "question",
    entityId: "q1",
    title: "Owner mentioned you",
    href: "/p/demo/questions#q-q1",
    actorName: "Owner",
    sourceKey: `cl:${kind}:${ago}`,
  });
  const [row] = await db
    .update(notification)
    .set({ createdAt: minutesAgo(ago) })
    .where(eq(notification.sourceKey, `cl:${kind}:${ago}`))
    .returning({ id: notification.id });
  return row.id;
}

async function statusOf(id: string) {
  const [row] = await db.select({ pushStatus: notification.pushStatus }).from(notification).where(eq(notification.id, id));
  return row.pushStatus;
}

const subscribe = (actor: Actor, endpoint = "https://push.example.com/send/editor") =>
  subscribePush(db, actor, { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" }, label: "Chrome on Windows" });

describe("dispatchPushes", () => {
  it("queues one push.send per subscription for a pending mention and marks it sent", async () => {
    const { id: subscriptionId } = await subscribe(editor);
    const id = await pending();
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([
      { jobName: "push.send", data: { notificationId: id, subscriptionId }, opts: { jobId: `push-${id}-${subscriptionId}`, attempts: 3, backoffMs: 10_000 } },
    ]);
    expect(await statusOf(id)).toBe("sent");
  });

  it("queues nothing new when it runs again", async () => {
    await subscribe(editor);
    await pending();
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);
    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toHaveLength(1);
  });

  it("skips the row when push is not set up", async () => {
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    await subscribe(editor);
    const id = await pending();
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([]);
    expect(await statusOf(id)).toBe("skipped");
  });

  it("skips the row while the user is active under the default rules", async () => {
    await subscribe(editor);
    const id = await pending();
    const deps = testDeps(db, { now: () => NOW });
    await deps.kv.set(activeKey(editor.userId), "1", 90);

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([]);
    expect(await statusOf(id)).toBe("skipped");
  });

  it("keeps the row pending during quiet hours", async () => {
    await subscribe(editor);
    await setPref(db, editor, NOTIFY_RULES_PREF, { quiet: { enabled: true, start: "11:00", end: "13:00", timeZone: "UTC" } });
    const id = await pending();
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([]);
    expect(await statusOf(id)).toBe("pending");
  });

  it("still sends a newer row when quiet-hours rows of another user exceed a batch", async () => {
    await subscribe(editor);
    await setPref(db, editor, NOTIFY_RULES_PREF, { quiet: { enabled: true, start: "11:00", end: "13:00", timeZone: "UTC" } });
    await db.insert(notification).values(
      Array.from({ length: 205 }, (_, i) => ({
        id: newId(),
        userId: editor.userId,
        projectId,
        kind: "mention" as const,
        entity: "question",
        entityId: "q1",
        title: "Owner mentioned you",
        href: "/p/demo/questions#q-q1",
        sourceKey: `cl:quiet:${i}`,
        createdAt: minutesAgo(30),
      })),
    );
    const { id: subscriptionId } = await subscribe(owner, "https://push.example.com/send/owner");
    await notify(db, {
      userId: owner.userId,
      projectId,
      kind: "mention",
      entity: "question",
      entityId: "q2",
      title: "Edi mentioned you",
      href: "/p/demo/questions#q-q2",
      sourceKey: "cl:owner",
    });
    const [{ id }] = await db.update(notification).set({ createdAt: minutesAgo(1) }).where(eq(notification.sourceKey, "cl:owner")).returning({ id: notification.id });
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([
      { jobName: "push.send", data: { notificationId: id, subscriptionId }, opts: { jobId: `push-${id}-${subscriptionId}`, attempts: 3, backoffMs: 10_000 } },
    ]);
    expect(await statusOf(id)).toBe("sent");
  });

  it("skips the row of a member removed after it was created", async () => {
    await subscribe(editor);
    const id = await pending();
    await removeMember(db, owner, "demo", editor.userId);
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([]);
    expect(await statusOf(id)).toBe("skipped");
  });

  it("skips a row created 25 hours ago", async () => {
    await subscribe(editor);
    const id = await pending("mention", 25 * 60);
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([]);
    expect(await statusOf(id)).toBe("skipped");
  });

  it("finds update.posted already skipped by notify under the default rules", async () => {
    await subscribe(editor);
    const id = await pending("update.posted");
    expect(await statusOf(id)).toBe("skipped");
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([]);
    expect(await statusOf(id)).toBe("skipped");
  });

  it("skips the row of a user without subscriptions", async () => {
    await subscribe(owner, "https://push.example.com/send/owner");
    const id = await pending();
    const deps = testDeps(db, { now: () => NOW });

    await dispatchPushes(deps);

    expect(deps.queues.deliver.jobs).toEqual([]);
    expect(await statusOf(id)).toBe("skipped");
  });

  it("leaves the row pending when the queue cannot be reached", async () => {
    await subscribe(editor);
    const id = await pending();
    const deps = testDeps(db, { now: () => NOW, queue: () => ({ add: () => Promise.reject(new Error("Connection is closed.")) }) });

    await expect(dispatchPushes(deps)).rejects.toThrow("Connection is closed.");

    expect(await statusOf(id)).toBe("pending");
  });

  it("is registered on the deliver queue, repeating every 5 s", async () => {
    expect(registeredJobs()).toContainEqual({ queue: "deliver", jobName: "notifications.dispatch" });
    expect(registeredRepeatables()).toContainEqual(
      expect.objectContaining({ queue: "deliver", jobName: "notifications.dispatch", schedule: { everyMs: 5000 } }),
    );
    await runJob("deliver", "notifications.dispatch", {}, testDeps(db, { now: () => NOW }));
  });
});
