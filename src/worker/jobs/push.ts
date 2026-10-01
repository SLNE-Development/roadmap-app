import { eq, sql } from "drizzle-orm";
import webpush from "web-push";
import { z } from "zod";
import { notification, pushSubscription, type PushSubscriptionRow } from "@/db/schema";
import { canReceive } from "@/lib/ops/notifications";
import { pushConfig, type PushConfig } from "@/lib/push-config";
import { QUEUE } from "@/lib/queue";
import type { WorkerDeps } from "../deps";
import { registerJob } from "../jobs";

/** Largest encoded payload; push services accept about 4 kB after encryption. */
const MAX_PAYLOAD_BYTES = 3000;
/** How long a push service keeps an undelivered push, in seconds. */
const TTL_SECONDS = 3600;
const TIMEOUT_MS = 10_000;
/** Failed sends in a row after which a subscription is deleted. */
const MAX_FAILURES = 10;

const sendData = z.object({ notificationId: z.string().min(1), subscriptionId: z.string().min(1) });
const testData = z.object({ subscriptionId: z.string().min(1) });

/** What the service worker receives and shows. */
interface PushPayload {
  title: string;
  body: string;
  href: string;
  tag: string;
  id: string;
}

const byteLength = (payload: PushPayload) => Buffer.byteLength(JSON.stringify(payload));

/** Cuts `text` by about `excess` characters, never splitting a surrogate pair. */
function shorten(text: string, excess: number): string {
  const chars = [...text];
  return chars.slice(0, Math.max(0, chars.length - Math.max(1, excess))).join("");
}

/**
 * Encodes the payload as JSON, shortening the body, then the title, until it fits in 3000 bytes; null when it
 * still does not fit.
 */
function encodePayload(payload: PushPayload): string | null {
  const fitted = { ...payload };
  while (byteLength(fitted) > MAX_PAYLOAD_BYTES && fitted.body) fitted.body = shorten(fitted.body, byteLength(fitted) - MAX_PAYLOAD_BYTES);
  while (byteLength(fitted) > MAX_PAYLOAD_BYTES && fitted.title) fitted.title = shorten(fitted.title, byteLength(fitted) - MAX_PAYLOAD_BYTES);
  return byteLength(fitted) > MAX_PAYLOAD_BYTES ? null : JSON.stringify(fitted);
}

/** Error codes of a connection that failed or broke off, besides undici's `UND_ERR_*`. */
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "EPIPE"]);

/** How a send ended. */
type Outcome =
  | { kind: "sent" }
  /** The push service answered with a non-2xx status. */
  | { kind: "answered"; status: number }
  /** The push service could not be reached. */
  | { kind: "network" }
  /** web-push refused before sending, such as for malformed subscription keys. */
  | { kind: "local"; error: unknown };

function outcomeOf(error: unknown): Outcome {
  if (!error || typeof error !== "object") return { kind: "local", error };
  if ("statusCode" in error && typeof error.statusCode === "number") return { kind: "answered", status: error.statusCode };
  const code = "code" in error && typeof error.code === "string" ? error.code : "";
  // web-push ends a request that runs past its timeout with this message and no code.
  const timedOut = error instanceof Error && error.message === "Socket timeout";
  if (timedOut || NETWORK_CODES.has(code) || code.startsWith("UND_ERR_")) return { kind: "network" };
  return { kind: "local", error };
}

async function attempt(target: webpush.PushSubscription, payload: string, options: webpush.RequestOptions): Promise<Outcome> {
  try {
    await webpush.sendNotification(target, payload, options);
    return { kind: "sent" };
  } catch (error) {
    return outcomeOf(error);
  }
}

/** The VAPID settings last checked, and whether web-push accepted them. */
let checkedVapid: { key: string; valid: boolean } | null = null;

/** Returns whether web-push accepts the VAPID settings; checks each set once and logs a rejected set once. */
function vapidValid(config: PushConfig): boolean {
  const key = `${config.subject}
${config.publicKey}
${config.privateKey}`;
  if (checkedVapid?.key !== key) {
    let valid = true;
    try {
      webpush.getVapidHeaders("https://push.example.com", config.subject, config.publicKey, config.privateKey, "aes128gcm");
    } catch (error) {
      valid = false;
      console.error(`Push is off: web-push rejects the VAPID settings (${error instanceof Error ? error.message : String(error)}).`);
    }
    checkedVapid = { key, valid };
  }
  return checkedVapid.valid;
}

/**
 * Sends one push to one subscription and records the outcome: a success clears the failures, 404 or 410 deletes
 * the subscription, 413 is retried once with an empty body. Other answers and network errors count against the
 * subscription, which is deleted at its tenth failure in a row. A payload that cannot be shortened to fit is not sent.
 *
 * @throws Error on a 429, a 5xx, a network error or an error raised by web-push before sending, so the job is retried
 */
async function deliver(deps: WorkerDeps, config: PushConfig, subscription: PushSubscriptionRow, payload: PushPayload, urgency: "high" | "normal"): Promise<void> {
  if (!vapidValid(config)) return;
  const encoded = encodePayload(payload);
  if (encoded === null) {
    console.error(`The push for subscription ${subscription.id} does not fit in ${MAX_PAYLOAD_BYTES} bytes; dropped it.`);
    return;
  }
  const target = { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } };
  const options = {
    TTL: TTL_SECONDS,
    urgency,
    topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 32),
    timeout: TIMEOUT_MS,
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
  };
  let outcome = await attempt(target, encoded, options);
  if (outcome.kind === "answered" && outcome.status === 413) {
    const empty = encodePayload({ ...payload, body: "" });
    if (empty !== null) outcome = await attempt(target, empty, options);
  }
  // Messages name the subscription id, never its endpoint.
  if (outcome.kind === "local") {
    console.error(`web-push refused to send to subscription ${subscription.id}.`);
    throw new Error(`Push to subscription ${subscription.id} failed before sending: ${outcome.error instanceof Error ? outcome.error.message : String(outcome.error)}`);
  }
  if (outcome.kind === "sent" || (outcome.kind === "answered" && outcome.status >= 200 && outcome.status < 300)) {
    await deps.db.update(pushSubscription).set({ lastSuccessAt: deps.now(), failures: 0 }).where(eq(pushSubscription.id, subscription.id));
    return;
  }
  const status = outcome.kind === "answered" ? outcome.status : undefined;
  if (status === 404 || status === 410) {
    await deps.db.delete(pushSubscription).where(eq(pushSubscription.id, subscription.id));
    return;
  }
  const [row] = await deps.db
    .update(pushSubscription)
    .set({ failures: sql`${pushSubscription.failures} + 1` })
    .where(eq(pushSubscription.id, subscription.id))
    .returning({ failures: pushSubscription.failures });
  if (row && row.failures >= MAX_FAILURES) {
    await deps.db.delete(pushSubscription).where(eq(pushSubscription.id, subscription.id));
    console.warn(`Push subscription ${subscription.id} failed ${row.failures} times in a row; deleted it.`);
  }
  if (status === undefined || status === 429 || status >= 500) {
    throw new Error(`Push to subscription ${subscription.id} failed${status === undefined ? " (network error)" : ` with ${status}`}`);
  }
  console.error(`The push service refused a push to subscription ${subscription.id} with ${status}; dropped it.`);
}

/**
 * Pushes one notification to one of its recipient's subscriptions. Does nothing when push is off, either row is
 * gone, the subscription now belongs to someone else or the recipient can no longer receive the notification.
 *
 * @throws Error on a 429, a 5xx or a network error, so the job is retried
 */
export async function sendPush(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { notificationId, subscriptionId } = sendData.parse(raw);
  const config = pushConfig();
  if (!config) return;
  const [row] = await deps.db.select().from(notification).where(eq(notification.id, notificationId));
  const [subscription] = await deps.db.select().from(pushSubscription).where(eq(pushSubscription.id, subscriptionId));
  if (!row || !subscription) return;
  // A browser that signed in as someone else must never get the previous owner's pushes.
  if (subscription.userId !== row.userId) return;
  if (!(await canReceive(deps.db, row.userId, row.projectId))) return;
  const payload = { title: row.title, body: row.body, href: row.href, tag: `${row.kind}:${row.entityId}`, id: row.id };
  const urgency = row.kind === "mention" || row.kind.endsWith("blocked") ? "high" : "normal";
  await deliver(deps, config, subscription, payload, urgency);
}

/**
 * Pushes the test notification to one subscription; does nothing when push is off or the subscription is gone.
 *
 * @throws Error on a 429, a 5xx or a network error, so the job is retried
 */
export async function sendPushTest(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { subscriptionId } = testData.parse(raw);
  const config = pushConfig();
  if (!config) return;
  const [subscription] = await deps.db.select().from(pushSubscription).where(eq(pushSubscription.id, subscriptionId));
  if (!subscription) return;
  const payload = { title: "Test notification", body: "Push works on this device.", href: "/settings/notifications", tag: "test", id: `test-${subscriptionId}` };
  await deliver(deps, config, subscription, payload, "normal");
}

registerJob(QUEUE.deliver, "push.send", (data, deps) => sendPush(deps, data));
registerJob(QUEUE.deliver, "push.test", (data, deps) => sendPushTest(deps, data));
