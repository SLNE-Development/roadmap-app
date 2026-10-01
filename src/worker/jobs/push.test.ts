import { eq } from "drizzle-orm";
import webpush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notification, pushSubscription } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { removeMember } from "@/lib/ops/members";
import { notify } from "@/lib/ops/notifications";
import { subscribePush } from "@/lib/ops/push";
import { createTestDb } from "@/test/db";
import { addMemberFixture, createProjectFixture } from "@/test/fixtures";
import { testDeps } from "../deps";
import { registeredJobs } from "../jobs";
import { sendPush, sendPushTest } from "./push";

vi.mock("web-push");
const sendNotification = vi.mocked(webpush.sendNotification);

const NOW = new Date("2026-10-01T12:00:00Z");

let db: Db;
let owner: Actor;
let editor: Actor;
let projectId: string;

beforeEach(async () => {
  vi.stubEnv("VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  vi.stubEnv("VAPID_SUBJECT", "mailto:admin@example.com");
  sendNotification.mockReset();
  sendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
  db = await createTestDb();
  ({ owner, projectId } = await createProjectFixture(db));
  editor = await addMemberFixture(db, owner, "demo", "editor", "Edi");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Notifies the editor about a mention and returns the row id. */
async function mention(): Promise<string> {
  await notify(db, {
    userId: editor.userId,
    projectId,
    kind: "mention",
    entity: "question",
    entityId: "q1",
    title: "Owner mentioned you",
    body: "Can you look at this?",
    href: "/p/demo/questions#q-q1",
    actorName: "Owner",
    sourceKey: "cl:1:mention",
  });
  const [row] = await db.select({ id: notification.id }).from(notification).where(eq(notification.sourceKey, "cl:1:mention"));
  return row.id;
}

async function subscribe(): Promise<string> {
  const { id } = await subscribePush(db, editor, {
    endpoint: "https://push.example.com/send/editor",
    keys: { p256dh: "p256dh-key", auth: "auth-key" },
    label: "Chrome on Windows",
  });
  return id;
}

async function subscriptionOf(id: string) {
  const [row] = await db.select().from(pushSubscription).where(eq(pushSubscription.id, id));
  return row;
}

/** A push service answer as web-push rejects with it. */
function rejection(statusCode: number) {
  return Object.assign(new Error(`Received unexpected response code ${statusCode}`), { statusCode, body: "", headers: {} });
}

/** The JSON payload of the nth `sendNotification` call. */
function payloadOf(call = 0): Record<string, string> {
  return JSON.parse(String(sendNotification.mock.calls[call][1]));
}

describe("push.send", () => {
  it("sends the notification and records the success", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    await db.update(pushSubscription).set({ failures: 3 }).where(eq(pushSubscription.id, subscriptionId));

    await sendPush(testDeps(db, { now: () => NOW }), { notificationId, subscriptionId });

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [target, , options] = sendNotification.mock.calls[0];
    expect(target).toEqual({ endpoint: "https://push.example.com/send/editor", keys: { p256dh: "p256dh-key", auth: "auth-key" } });
    expect(payloadOf()).toEqual({
      title: "Owner mentioned you",
      body: "Can you look at this?",
      href: "/p/demo/questions#q-q1",
      tag: "mention:q1",
      id: notificationId,
    });
    expect(options).toMatchObject({
      TTL: 3600,
      urgency: "high",
      topic: "mention-q1",
      vapidDetails: { subject: "mailto:admin@example.com", publicKey: "public-key", privateKey: "private-key" },
    });
    const row = await subscriptionOf(subscriptionId);
    expect(row.lastSuccessAt).toEqual(NOW);
    expect(row.failures).toBe(0);
  });

  it("deletes the subscription on 410 without throwing", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    sendNotification.mockRejectedValue(rejection(410));

    await sendPush(testDeps(db), { notificationId, subscriptionId });

    expect(await subscriptionOf(subscriptionId)).toBeUndefined();
  });

  it("retries once with an empty body on 413", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    sendNotification.mockRejectedValueOnce(rejection(413));

    await sendPush(testDeps(db, { now: () => NOW }), { notificationId, subscriptionId });

    expect(sendNotification).toHaveBeenCalledTimes(2);
    expect(payloadOf(1)).toMatchObject({ title: "Owner mentioned you", body: "" });
    expect((await subscriptionOf(subscriptionId)).lastSuccessAt).toEqual(NOW);
  });

  it("counts a failure and throws on 500", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    sendNotification.mockRejectedValue(rejection(500));

    await expect(sendPush(testDeps(db), { notificationId, subscriptionId })).rejects.toThrow();

    expect((await subscriptionOf(subscriptionId)).failures).toBe(1);
  });

  it("deletes the subscription at its tenth failure in a row", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    await db.update(pushSubscription).set({ failures: 9 }).where(eq(pushSubscription.id, subscriptionId));
    sendNotification.mockRejectedValue(rejection(429));

    await expect(sendPush(testDeps(db), { notificationId, subscriptionId })).rejects.toThrow();

    expect(await subscriptionOf(subscriptionId)).toBeUndefined();
  });

  it("counts a network error as a failure and throws", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    sendNotification.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));

    await expect(sendPush(testDeps(db), { notificationId, subscriptionId })).rejects.toThrow();

    expect((await subscriptionOf(subscriptionId)).failures).toBe(1);
  });

  it("throws without counting a failure when web-push refuses before sending", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    sendNotification.mockRejectedValue(new Error("The subscription p256dh value should be 65 bytes long."));

    await expect(sendPush(testDeps(db), { notificationId, subscriptionId })).rejects.toThrow();

    expect((await subscriptionOf(subscriptionId)).failures).toBe(0);
  });

  it("counts a failure without throwing on 400", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    sendNotification.mockRejectedValue(rejection(400));

    await sendPush(testDeps(db), { notificationId, subscriptionId });

    expect((await subscriptionOf(subscriptionId)).failures).toBe(1);
  });

  it("sends nothing and keeps the subscription when the VAPID settings are invalid", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    vi.stubEnv("VAPID_SUBJECT", "not-a-url");
    vi.mocked(webpush.getVapidHeaders).mockImplementationOnce(() => {
      throw new Error("Vapid subject is not a valid URL.");
    });

    await sendPush(testDeps(db), { notificationId, subscriptionId });

    expect(sendNotification).not.toHaveBeenCalled();
    expect((await subscriptionOf(subscriptionId)).failures).toBe(0);
  });

  it("shortens a 10 kB body to a payload of at most 3000 bytes", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    await db.update(notification).set({ body: "é".repeat(5000) }).where(eq(notification.id, notificationId));

    await sendPush(testDeps(db), { notificationId, subscriptionId });

    const payload = String(sendNotification.mock.calls[0][1]);
    expect(Buffer.byteLength(payload)).toBeLessThanOrEqual(3000);
    expect(JSON.parse(payload)).toMatchObject({ title: "Owner mentioned you", href: "/p/demo/questions#q-q1" });
  });

  it("makes no call when the payload cannot be shortened to 3000 bytes", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    await db.update(notification).set({ href: "/p/demo/" + "x".repeat(4000) }).where(eq(notification.id, notificationId));

    await sendPush(testDeps(db), { notificationId, subscriptionId });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("makes no call for a removed member's notification", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    await removeMember(db, owner, "demo", editor.userId);

    await sendPush(testDeps(db), { notificationId, subscriptionId });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("makes no call when the subscription now belongs to someone else", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();
    await db.update(pushSubscription).set({ userId: owner.userId }).where(eq(pushSubscription.id, subscriptionId));

    await sendPush(testDeps(db), { notificationId, subscriptionId });

    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("makes no call when either row is gone or push is off", async () => {
    const subscriptionId = await subscribe();
    const notificationId = await mention();

    await sendPush(testDeps(db), { notificationId: "gone", subscriptionId });
    await sendPush(testDeps(db), { notificationId, subscriptionId: "gone" });
    vi.stubEnv("VAPID_SUBJECT", "");
    await sendPush(testDeps(db), { notificationId, subscriptionId });

    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("push.test", () => {
  it("sends the test notification to the device", async () => {
    const subscriptionId = await subscribe();

    await sendPushTest(testDeps(db, { now: () => NOW }), { subscriptionId });

    expect(payloadOf()).toMatchObject({ title: "Test notification", body: "Push works on this device.", href: "/settings/notifications" });
    expect((await subscriptionOf(subscriptionId)).lastSuccessAt).toEqual(NOW);
  });

  it("registers both jobs on the deliver queue", () => {
    expect(registeredJobs()).toEqual(
      expect.arrayContaining([
        { queue: "deliver", jobName: "push.send" },
        { queue: "deliver", jobName: "push.test" },
      ]),
    );
  });
});
