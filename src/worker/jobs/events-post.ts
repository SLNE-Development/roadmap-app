import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { eventPost, eventRequest, eventTodo, requestLog, type EventPostRow, type EventRequestRow } from "@/db/schema";
import type { Db } from "@/db/types";
import { sendMessage, toDiscordEmbed, type DiscordBody, type WebhookFile, type WebhookResult } from "@/lib/discord-webhook";
import { loadEventSecrets } from "@/lib/event-secrets";
import { mayPing, POST_TARGET, POST_TODO_KEY, type PostPart } from "@/lib/event-messages";
import { loadPostSettings, type PostSettings } from "@/lib/ops/event-settings";
import { readUploadForWorker } from "@/lib/ops/uploads";
import { QUEUE } from "@/lib/queue";
import type { WorkerDeps } from "../deps";
import { registerJob } from "../jobs";

/** How long the lock of one post lives at most; a part takes at most 10 s and a post has a handful. */
const LOCK_SECONDS = 300;
/** Re-queues behind a held lock, and 429 retries, in a row before the job gives up and BullMQ's backoff takes over. */
const MAX_RETRIES = 10;
const BUSY_DELAY_MS = 5_000;

const jobData = z.object({
  postId: z.string().min(1),
  attempt: z.number().int().min(0),
  /** 429 retries so far. */
  retry: z.number().int().min(0).optional(),
  /** Re-queues behind a held lock so far. */
  busy: z.number().int().min(0).optional(),
});

/**
 * Makes sure the request has its Discord scheduled event before the first send of an announcement. Task 13 fills this in
 * with the bot-token client; until then there is no event and the card is the details embed.
 *
 * @returns the Discord event id, or null while there is none
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the stub ignores its arguments until Task 13
export async function ensureDiscordEvent(_deps: WorkerDeps, _request: EventRequestRow): Promise<string | null> {
  return null;
}

const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Reads the image of an embed part as an attachment; null when the upload or its file is gone, so the post still goes out. */
async function imageFile(db: Db, uploadId: string | null | undefined): Promise<WebhookFile | null> {
  if (!uploadId) return null;
  try {
    const { bytes, mime } = await readUploadForWorker(db, uploadId);
    return { name: `image.${EXTENSION[mime] ?? "png"}`, bytes, mime };
  } catch {
    return null;
  }
}

/** The body and files of one part. Only part 1 of a post that may ping, and only while it has no id yet, mentions the role. */
async function partRequest(db: Db, post: EventPostRow, settings: PostSettings, part: PostPart, index: number): Promise<{ body: DiscordBody; files: WebhookFile[] }> {
  const mention = settings.pingRoleId ? `<@&${settings.pingRoleId}>` : null;
  const pings = index === 0 && mention !== null && mayPing(post.kind, post.pingRole) && part.content.startsWith(mention);
  const allowed_mentions: DiscordBody["allowed_mentions"] = pings ? { parse: [], roles: [settings.pingRoleId!] } : { parse: [] };
  if (part.kind !== "embed" || !part.embed) return { body: { content: part.content, username: settings.postAs, allowed_mentions }, files: [] };
  const file = await imageFile(db, part.uploadId ?? part.embed.imageUploadId);
  return { body: { embeds: [toDiscordEmbed(part.embed, file?.name ?? null)], username: settings.postAs, allowed_mentions }, files: file ? [file] : [] };
}

/** Writes the post's progress only while this attempt still owns it. */
async function update(db: Db, post: EventPostRow, set: Partial<typeof eventPost.$inferInsert>): Promise<void> {
  await db
    .update(eventPost)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(eventPost.id, post.id), eq(eventPost.attempt, post.attempt)));
}

/** Marks the post posted, ticks its to-do for the starter and logs it, in one transaction. */
async function finish(db: Db, post: EventPostRow, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(eventPost)
      .set({ status: "posted", postedAt: now, lastError: null, updatedAt: now })
      .where(and(eq(eventPost.id, post.id), eq(eventPost.attempt, post.attempt)));
    const templateKey = POST_TODO_KEY[post.kind];
    if (templateKey) {
      await tx
        .update(eventTodo)
        .set({ doneAt: now, doneBy: post.postedBy })
        .where(and(eq(eventTodo.requestId, post.requestId), eq(eventTodo.templateKey, templateKey), isNull(eventTodo.doneAt)));
    }
    await tx.insert(requestLog).values({ requestId: post.requestId, field: "post", oldValue: "sending", newValue: `${post.kind} posted`, authorUserId: post.postedBy });
  });
}

/** Sends every part without a message id, in order, storing each id the moment Discord answers. */
async function sendParts(deps: WorkerDeps, post: EventPostRow, settings: PostSettings, url: string, retry: number): Promise<void> {
  const target = POST_TARGET[post.kind];
  const parts = post.parts.map((p) => ({ ...p }));
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].messageId !== null) continue;
    const { body, files } = await partRequest(deps.db, post, settings, parts[i], i);
    const result: WebhookResult = await sendMessage({ kind: target, url }, body, files);
    if (result.kind === "ok") {
      parts[i] = { ...parts[i], messageId: result.id, sentAt: deps.now().toISOString() };
      await deps.db.transaction((tx) => tx.update(eventPost).set({ parts, updatedAt: new Date() }).where(and(eq(eventPost.id, post.id), eq(eventPost.attempt, post.attempt))));
      continue;
    }
    if (result.kind === "retry") {
      const n = retry + 1;
      if (n > MAX_RETRIES) {
        const message = `Discord rate-limited the ${post.kind} post ${n} times in a row.`;
        await update(deps.db, post, { status: "partial", lastError: message });
        throw new Error(message);
      }
      await update(deps.db, post, { lastError: `Discord is rate-limiting the ${target} webhook; sending goes on shortly.` });
      await deps.queue("deliver").add(
        "events.post",
        { postId: post.id, attempt: post.attempt, retry: n },
        { jobId: `event-post-${post.id}-${post.attempt}-r${n}`, delayMs: result.delayMs, attempts: 5, backoffMs: 5000 },
      );
      return;
    }
    if (result.kind === "gone") {
      await update(deps.db, post, { status: "failed", lastError: `Discord no longer accepts the ${target} webhook (${result.status}). An admin must set a new one.` });
      return;
    }
    if (result.kind === "rejected") {
      await update(deps.db, post, { status: "failed", lastError: `Discord rejected part ${i + 1} of the ${post.kind} post (${result.status}).` });
      return;
    }
    await update(deps.db, post, { status: "partial", lastError: `Sending part ${i + 1} of the ${post.kind} post failed: ${result.error.message}` });
    throw result.error;
  }
  await finish(deps.db, post, deps.now());
}

/** Runs one send attempt while holding the post's lock. */
async function runPost(deps: WorkerDeps, postId: string, attempt: number, retry: number): Promise<void> {
  const [loaded] = await deps.db.select().from(eventPost).where(eq(eventPost.id, postId)).limit(1);
  // A stale job (an older attempt, or a post that is posted, deleted, a draft or failed) sends nothing. `failed` is
  // terminal for its attempt (a 4xx stop); `partial` of this very attempt is a retry after a 5xx.
  if (!loaded || loaded.attempt !== attempt || !["sending", "partial"].includes(loaded.status)) return;
  const [request] = await deps.db.select().from(eventRequest).where(eq(eventRequest.id, loaded.requestId)).limit(1);
  if (!request) return;
  const settings = await loadPostSettings(deps.db);
  const secrets = await loadEventSecrets(deps.db);
  const target = POST_TARGET[loaded.kind];
  const url = target === "team" ? secrets.teamWebhook : secrets.publicWebhook;
  if (!url) {
    await update(deps.db, loaded, { status: "failed", lastError: `The ${target} webhook is not set. An admin sets it in Event settings.` });
    return;
  }
  const post: EventPostRow = { ...loaded, status: "sending" };
  if (loaded.status !== "sending") await update(deps.db, loaded, { status: "sending" });
  // Task 13 uses the id to make the card an event link; without the bot token the card is the details embed.
  if (post.kind === "announcement" && secrets.botToken && !request.discordEventId && post.parts.every((p) => p.messageId === null)) await ensureDiscordEvent(deps, request);
  await sendParts(deps, post, settings, url, retry);
}

/**
 * Sends the unsent parts of a post, in order, and stores each message id right after Discord answers, so a retry or a
 * resume never posts a part twice. A Kv lock keeps two jobs of one post apart. A 429 queues a delayed job; 401/404 and other
 * 4xx stop the post with a visible error and no retry; 5xx and network errors throw so BullMQ retries.
 *
 * Delivery is at least once for the one part in flight: a crash between Discord's answer and the database write posts that
 * part again on retry.
 *
 * @throws Error on a 5xx or a network error, an 11th 429 in a row, or an 11th held lock in a row
 */
export async function sendPost(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { postId, attempt, retry = 0, busy = 0 } = jobData.parse(raw);
  const key = `event-post:${postId}`;
  const token = randomUUID();
  if (await deps.kv.setIfAbsent(key, token, LOCK_SECONDS)) {
    try {
      await runPost(deps, postId, attempt, retry);
    } finally {
      // Only the holder deletes: a lock that expired and was taken by another job stays.
      if ((await deps.kv.get(key)) === token) await deps.kv.del(key);
    }
    return;
  }
  const n = busy + 1;
  if (n > MAX_RETRIES) throw new Error(`Another job held the lock of post ${postId} ${n} times in a row.`);
  const base = `event-post-${postId}-${attempt}${retry > 0 ? `-r${retry}` : ""}`;
  await deps.queue("deliver").add("events.post", { postId, attempt, retry, busy: n }, { jobId: `${base}-b${n}`, delayMs: BUSY_DELAY_MS, attempts: 5, backoffMs: 5000 });
}

// Attempts and backoff are set where the job is enqueued (5 tries, exponential from 5 s).
registerJob(QUEUE.deliver, "events.post", (data, deps) => sendPost(deps, data));
