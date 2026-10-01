import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { eventPost, eventRequest, eventTodo, requestLog, type EventPostRow, type EventRequestRow } from "@/db/schema";
import type { Db } from "@/db/types";
import { deleteMessage, editMessage, sendMessage, toDiscordEmbed, type DiscordBody, type Webhook, type WebhookFile, type WebhookResult } from "@/lib/discord-webhook";
import { loadEventSecrets, loadWebhook } from "@/lib/event-secrets";
import { buildResolvedEmbed, discordEventUrl, GERMAN, keepsMention, mayPing, plannedParts, POST_KINDS, POST_TARGET, POST_TODO_KEY, type PostPart } from "@/lib/event-messages";
import { loadPostSettings, type PostSettings } from "@/lib/ops/event-settings";
import { testResultKey } from "@/lib/ops/request-posts";
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

/** The body and files of one part, with the mentions the caller allows. */
export async function partBody(db: Db, settings: PostSettings, part: PostPart, allowed_mentions: DiscordBody["allowed_mentions"]): Promise<{ body: DiscordBody; files: WebhookFile[] }> {
  if (part.kind !== "embed" || !part.embed) return { body: { content: part.content, username: settings.postAs, allowed_mentions }, files: [] };
  const file = await imageFile(db, part.uploadId ?? part.embed.imageUploadId);
  return { body: { embeds: [toDiscordEmbed(part.embed, file?.name ?? null)], username: settings.postAs, allowed_mentions }, files: file ? [file] : [] };
}

/** The body and files of one part of a send. Only part 1 of a post that may ping, and only while it has no id yet, mentions the role. */
async function partRequest(db: Db, post: EventPostRow, settings: PostSettings, part: PostPart, index: number): Promise<{ body: DiscordBody; files: WebhookFile[] }> {
  const mention = settings.pingRoleId ? `<@&${settings.pingRoleId}>` : null;
  const pings = index === 0 && mention !== null && mayPing(post.kind, post.pingRole) && part.content.startsWith(mention);
  return partBody(db, settings, part, pings ? { parse: [], roles: [settings.pingRoleId!] } : { parse: [] });
}

/** Writes the post's progress only while this attempt still owns it. */
async function update(db: Db, post: EventPostRow, set: Partial<typeof eventPost.$inferInsert>): Promise<boolean> {
  const rows = await db
    .update(eventPost)
    .set({ ...set, updatedAt: new Date() })
    .where(and(eq(eventPost.id, post.id), eq(eventPost.attempt, post.attempt)))
    .returning({ id: eventPost.id });
  return rows.length > 0;
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

/**
 * Runs `run` while holding the post's Kv lock. Behind a held lock the job is queued again by `requeue` (the busy count so
 * far plus one) after 5 s; the 11th time in a row it throws.
 */
async function withLock(deps: WorkerDeps, postId: string, busy: number, requeue: (busy: number) => Promise<void>, run: () => Promise<void>): Promise<void> {
  const key = `event-post:${postId}`;
  const token = randomUUID();
  if (await deps.kv.setIfAbsent(key, token, LOCK_SECONDS)) {
    try {
      await run();
    } finally {
      // Only the holder deletes: a lock that expired and was taken by another job stays.
      if ((await deps.kv.get(key)) === token) await deps.kv.del(key);
    }
    return;
  }
  const n = busy + 1;
  if (n > MAX_RETRIES) throw new Error(`Another job held the lock of post ${postId} ${n} times in a row.`);
  await requeue(n);
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
  const base = `event-post-${postId}-${attempt}${retry > 0 ? `-r${retry}` : ""}`;
  await withLock(deps, postId, busy, (n) => deps.queue("deliver").add("events.post", { postId, attempt, retry, busy: n }, { jobId: `${base}-b${n}`, delayMs: BUSY_DELAY_MS, attempts: 5, backoffMs: 5000 }), () => runPost(deps, postId, attempt, retry));
}

/** Ends a job quietly after it recorded why on the post. */
class Stop extends Error {}

/** What the edit, delete and resolve jobs share: the post as this run owns it, where it posts, and how a 429 re-queues it. */
interface Run {
  deps: WorkerDeps;
  post: EventPostRow;
  hook: Webhook;
  settings: PostSettings;
  retry: number;
  /** Queues the same job again after `delayMs`, with the 429 count `n`. */
  requeue: (n: number, delayMs: number) => Promise<void>;
}

/**
 * Turns an answer of Discord into the message id, or ends the run: a 429 queues the job again, 401/404 and other 4xx leave
 * the post `partial` with a visible error and no retry, a 5xx or network error leaves it `partial` and throws so BullMQ
 * retries. `what` names the call in the error.
 */
async function settle(run: Run, result: WebhookResult, what: string): Promise<string> {
  const { deps, post, hook } = run;
  if (result.kind === "ok") return result.id;
  if (result.kind === "retry") {
    const n = run.retry + 1;
    if (n > MAX_RETRIES) {
      const message = `Discord rate-limited the ${what} ${n} times in a row.`;
      await update(deps.db, post, { status: "partial", lastError: message });
      throw new Error(message);
    }
    await update(deps.db, post, { lastError: `Discord is rate-limiting the ${hook.kind} webhook; the ${what} goes on shortly.` });
    await run.requeue(n, result.delayMs);
    throw new Stop();
  }
  if (result.kind === "gone") {
    await update(deps.db, post, { status: "partial", lastError: `Discord no longer accepts the ${hook.kind} webhook (${result.status}). An admin must set a new one.` });
    throw new Stop();
  }
  if (result.kind === "rejected") {
    await update(deps.db, post, { status: "partial", lastError: `Discord rejected the ${what} (${result.status}).` });
    throw new Stop();
  }
  await update(deps.db, post, { status: "partial", lastError: `The ${what} failed: ${result.error.message}` });
  throw result.error;
}

/** Whether Discord says the message is gone: a 404 that is not "Unknown Webhook" (10015). */
const isMissing = (result: WebhookResult): boolean => result.kind === "gone" && result.status === 404 && result.code !== 10015;

/** Stores the post's parts while this attempt still owns it; a run that lost the post to a newer click stops here. */
async function saveParts(deps: WorkerDeps, post: EventPostRow, parts: PostPart[]): Promise<void> {
  if (!(await update(deps.db, post, { parts }))) throw new Stop();
}

/** Sends `part` as a new message that pings nobody. */
async function sendNew(run: Run, part: PostPart, what: string): Promise<string> {
  const { body, files } = await partBody(run.deps.db, run.settings, part, { parse: [] });
  return settle(run, await sendMessage(run.hook, body, files), what);
}

/** Patches the stored message `stored` to `want` without pinging; a message a human deleted is sent again. Returns the id now holding the part. */
async function patchOrResend(run: Run, stored: PostPart, want: PostPart, what: string): Promise<string> {
  if (stored.messageId === null) return sendNew(run, want, what);
  const { body, files } = await partBody(run.deps.db, run.settings, want, { parse: [] });
  // A card that changes kind must clear what the old kind left behind.
  if (stored.kind !== want.kind) {
    if (want.kind === "embed") body.content = "";
    else body.embeds = [];
  }
  const result = await editMessage(run.hook, stored.messageId, body, files);
  return isMissing(result) ? sendNew(run, want, what) : settle(run, result, what);
}

/** Deletes the stored message `id`; one that is already gone counts as deleted. */
async function removeMessage(run: Run, id: string, what: string): Promise<void> {
  const result = await deleteMessage(run.hook, id);
  if (!isMissing(result)) await settle(run, result, what);
}

/** A canonical text of `value` with sorted keys, so jsonb's key order never makes two equal embeds differ. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Whether the planned card differs from the stored one. */
const cardChanged = (stored: PostPart, want: PostPart): boolean =>
  stored.kind !== want.kind || stored.content !== want.content || canonical(stored.embed ?? null) !== canonical(want.embed ?? null) || (stored.uploadId ?? null) !== (want.uploadId ?? null);

/** What an edit, delete or resolve run needs, loaded after the guard; null (after a visible error) when it cannot run. */
async function prepare(deps: WorkerDeps, loaded: EventPostRow, job: { name: string; data: (n: number) => Record<string, unknown>; id: string }, retry: number): Promise<{ run: Run; request: EventRequestRow } | null> {
  const [request] = await deps.db.select().from(eventRequest).where(eq(eventRequest.id, loaded.requestId)).limit(1);
  if (!request) return null;
  const settings = await loadPostSettings(deps.db);
  const secrets = await loadEventSecrets(deps.db);
  const target = POST_TARGET[loaded.kind];
  const url = target === "team" ? secrets.teamWebhook : secrets.publicWebhook;
  if (!url) {
    await update(deps.db, loaded, { status: "partial", lastError: `The ${target} webhook is not set. An admin sets it in Event settings.` });
    return null;
  }
  if (loaded.status !== "sending") await update(deps.db, loaded, { status: "sending" });
  const post: EventPostRow = { ...loaded, status: "sending" };
  const requeue = (n: number, delayMs: number) =>
    deps.queue("deliver").add(job.name, job.data(n), { jobId: `${job.id}-r${n}`, delayMs, attempts: 5, backoffMs: 5000 });
  return { run: { deps, post, hook: { kind: target, url }, settings, retry, requeue }, request };
}

const editData = z.object({ postId: z.string().min(1), editVersion: z.number().int().min(1), attempt: z.number().int().min(0), retry: z.number().int().min(0).optional(), busy: z.number().int().min(0).optional() });

/** Brings the stored messages of an edited post in line with its new plan (Review Focus 3). */
async function runEdit(deps: WorkerDeps, postId: string, editVersion: number, attempt: number, retry: number): Promise<void> {
  const [loaded] = await deps.db.select().from(eventPost).where(eq(eventPost.id, postId)).limit(1);
  // A stale job (an older click, or a post nobody is editing) changes nothing.
  if (!loaded || loaded.attempt !== attempt || loaded.editVersion !== editVersion || !["sending", "partial"].includes(loaded.status)) return;
  const ctx = await prepare(deps, loaded, { name: "events.edit", data: (n) => ({ postId, editVersion, attempt, retry: n }), id: `event-edit-${postId}-${loaded.attempt}` }, retry);
  if (!ctx) return;
  const { run, request } = ctx;
  const { post, settings } = run;
  let planned: PostPart[];
  try {
    planned = plannedParts({ ...post, pingRole: keepsMention(post.parts) }, request, settings, { discordEventUrl: discordEventUrl(request, settings) });
  } catch (error) {
    await update(deps.db, post, { status: "partial", lastError: error instanceof Error ? error.message : "The message does not fit Discord." });
    return;
  }
  const wantTexts = planned.filter((p) => p.kind === "text");
  const wantCard = planned.at(-1)!;
  const texts = post.parts.filter((p) => p.kind === "text").map((p) => ({ ...p }));
  let card: PostPart | undefined = post.parts.filter((p) => p.kind !== "text").at(-1);
  const sent = () => deps.now().toISOString();
  const persist = () => saveParts(deps, post, [...texts, ...(card ? [card] : [])]);

  // 1. The first min(n, m) text parts, in place; an unchanged chunk costs no request.
  for (let i = 0; i < Math.min(wantTexts.length, texts.length); i++) {
    if (texts[i].messageId !== null && texts[i].content === wantTexts[i].content) continue;
    const id = await patchOrResend(run, texts[i], wantTexts[i], `part ${i + 1} of the ${post.kind} post`);
    texts[i] = { ...wantTexts[i], messageId: id, sentAt: texts[i].sentAt ?? sent() };
    await persist();
  }
  let cardDone = false;
  if (wantTexts.length > texts.length) {
    // 2. More text than before: the card goes first, the new text is sent, then the card is sent again as the last message.
    if (card?.messageId) {
      await removeMessage(run, card.messageId, `card of the ${post.kind} post`);
      card = { ...card, messageId: null, sentAt: null };
      await persist();
    }
    for (let j = texts.length; j < wantTexts.length; j++) {
      const id = await sendNew(run, wantTexts[j], `part ${j + 1} of the ${post.kind} post`);
      texts.push({ ...wantTexts[j], messageId: id, sentAt: sent() });
      await persist();
    }
    const id = await sendNew(run, wantCard, `card of the ${post.kind} post`);
    card = { ...wantCard, messageId: id, sentAt: sent() };
    await persist();
    cardDone = true;
  } else {
    // 3. Less text than before: the surplus messages go, the card stays last.
    while (texts.length > wantTexts.length) {
      const surplus = texts[wantTexts.length];
      if (surplus.messageId !== null) await removeMessage(run, surplus.messageId, `surplus part of the ${post.kind} post`);
      texts.splice(wantTexts.length, 1);
      await persist();
    }
  }
  // 4. The card, when it changed (or was never sent).
  if (!cardDone && (!card || card.messageId === null || cardChanged(card, wantCard))) {
    const id = await patchOrResend(run, card ?? { ...wantCard, messageId: null, sentAt: null }, wantCard, `card of the ${post.kind} post`);
    card = { ...wantCard, messageId: id, sentAt: card?.sentAt ?? sent() };
    await persist();
  }
  await deps.db.transaction(async (tx) => {
    await tx.update(eventPost).set({ status: "posted", lastError: null, updatedAt: deps.now() }).where(and(eq(eventPost.id, post.id), eq(eventPost.attempt, post.attempt)));
    await tx.insert(requestLog).values({ requestId: post.requestId, field: "post", oldValue: "sending", newValue: `${post.kind} edit posted`, authorUserId: post.postedBy });
  });
}

/**
 * Edits the stored Discord messages of a post to its new text, in place and without a ping. Each stored id is updated,
 * deleted or replaced once and the parts are saved after every call, so a retry or `resumePost` continues where it stopped.
 *
 * @throws Error on a 5xx or a network error, an 11th 429 in a row, or an 11th held lock in a row
 */
export async function editPostMessages(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { postId, editVersion, attempt, retry = 0, busy = 0 } = editData.parse(raw);
  const base = `event-edit-${postId}-${attempt}${retry > 0 ? `-r${retry}` : ""}`;
  const requeue = (n: number) => deps.queue("deliver").add("events.edit", { postId, editVersion, attempt, retry, busy: n }, { jobId: `${base}-b${n}`, delayMs: BUSY_DELAY_MS, attempts: 5, backoffMs: 5000 });
  await withLock(deps, postId, busy, requeue, () => runEdit(deps, postId, editVersion, attempt, retry).catch(ignoreStop));
}

/** Swallows {@link Stop}, which only ends a run whose outcome is already on the post. */
function ignoreStop(error: unknown): void {
  if (!(error instanceof Stop)) throw error;
}

const deleteData = z.object({ postId: z.string().min(1), attempt: z.number().int().min(0), retry: z.number().int().min(0).optional(), busy: z.number().int().min(0).optional() });

/** Deletes every stored message of a post; an id is cleared (and the part marked) the moment its message is gone. */
async function runDelete(deps: WorkerDeps, postId: string, attempt: number, retry: number): Promise<void> {
  const [loaded] = await deps.db.select().from(eventPost).where(eq(eventPost.id, postId)).limit(1);
  if (!loaded || loaded.attempt !== attempt || !["sending", "partial"].includes(loaded.status) || !loaded.parts.some((p) => p.messageId !== null || p.deleted)) return;
  const ctx = await prepare(deps, loaded, { name: "events.delete", data: (n) => ({ postId, attempt, retry: n }), id: `event-delete-${postId}-${loaded.attempt}` }, retry);
  if (!ctx) return;
  const { run } = ctx;
  const parts = run.post.parts.map((p) => ({ ...p }));
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].messageId === null) continue;
    await removeMessage(run, parts[i].messageId!, `delete of part ${i + 1} of the ${run.post.kind} post`);
    parts[i] = { ...parts[i], messageId: null, sentAt: null, deleted: true };
    await saveParts(deps, run.post, parts);
  }
  await deps.db.transaction(async (tx) => {
    await tx.update(eventPost).set({ status: "deleted", lastError: null, updatedAt: deps.now() }).where(and(eq(eventPost.id, postId), eq(eventPost.attempt, run.post.attempt)));
    await tx.insert(requestLog).values({ requestId: run.post.requestId, field: "post", oldValue: "sending", newValue: `${run.post.kind} deleted`, authorUserId: run.post.postedBy });
  });
}

/**
 * Deletes the Discord messages of a post, one stored id after the other; a message that is already gone counts as deleted.
 * A Discord scheduled event is not touched.
 *
 * @throws Error on a 5xx or a network error, an 11th 429 in a row, or an 11th held lock in a row
 */
export async function deletePostMessages(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { postId, attempt, retry = 0, busy = 0 } = deleteData.parse(raw);
  const base = `event-delete-${postId}-${attempt}${retry > 0 ? `-r${retry}` : ""}`;
  const requeue = (n: number) => deps.queue("deliver").add("events.delete", { postId, attempt, retry, busy: n }, { jobId: `${base}-b${n}`, delayMs: BUSY_DELAY_MS, attempts: 5, backoffMs: 5000 });
  await withLock(deps, postId, busy, requeue, () => runDelete(deps, postId, attempt, retry).catch(ignoreStop));
}

const resolveData = z.object({ postId: z.string().min(1), attempt: z.number().int().min(0), retry: z.number().int().min(0).optional(), busy: z.number().int().min(0).optional() });

/** Turns the disaster message into the resolved one and follows it with the back-online message. */
async function runResolve(deps: WorkerDeps, postId: string, attempt: number, retry: number): Promise<void> {
  const [loaded] = await deps.db.select().from(eventPost).where(eq(eventPost.id, postId)).limit(1);
  if (!loaded || loaded.attempt !== attempt || !["sending", "partial"].includes(loaded.status) || loaded.kind !== "disaster" || loaded.note === null || loaded.resolvedAt !== null) return;
  const ctx = await prepare(deps, loaded, { name: "events.resolve", data: (n) => ({ postId, attempt, retry: n }), id: `event-resolve-${postId}-${attempt}` }, retry);
  if (!ctx) return;
  const { run, request } = ctx;
  const { post, settings } = run;
  const parts = post.parts.map((p) => ({ ...p }));
  const embed = buildResolvedEmbed(request, settings, post.note === "" ? null : post.note);
  const resolved: PostPart = { kind: "embed", content: "", embed, uploadId: embed.imageUploadId, messageId: parts[0]?.messageId ?? null, sentAt: parts[0]?.sentAt ?? null };
  const messageId = await patchOrResend(run, parts[0] ?? resolved, resolved, "resolved message");
  parts[0] = { ...resolved, messageId, sentAt: resolved.sentAt ?? deps.now().toISOString() };
  await saveParts(deps, post, parts);
  if (!parts[1]?.messageId) {
    const content = GERMAN.backOnline(request.title);
    const body: DiscordBody = { content, username: settings.postAs, allowed_mentions: { parse: [] } };
    const replyId = await settle(run, await sendMessage(run.hook, body), "back-online message");
    parts[1] = { kind: "text", content, messageId: replyId, sentAt: deps.now().toISOString() };
  }
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await tx.update(eventPost).set({ parts, status: "posted", resolvedAt: now, lastError: null, updatedAt: now }).where(and(eq(eventPost.id, postId), eq(eventPost.attempt, post.attempt)));
    await tx.insert(requestLog).values({ requestId: post.requestId, field: "post", oldValue: "sending", newValue: "disaster resolved", authorUserId: post.postedBy });
  });
}

/**
 * Resolves a posted disaster message: patches it to the resolved template and posts the German back-online message after it (a webhook cannot reply). A disaster
 * message a human deleted is replaced by a new resolved message. Nothing pings.
 *
 * @throws Error on a 5xx or a network error, an 11th 429 in a row, or an 11th held lock in a row
 */
export async function resolveDisasterMessage(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { postId, attempt, retry = 0, busy = 0 } = resolveData.parse(raw);
  const base = `event-resolve-${postId}-${attempt}${retry > 0 ? `-r${retry}` : ""}`;
  const requeue = (n: number) => deps.queue("deliver").add("events.resolve", { postId, attempt, retry, busy: n }, { jobId: `${base}-b${n}`, delayMs: BUSY_DELAY_MS, attempts: 5, backoffMs: 5000 });
  await withLock(deps, postId, busy, requeue, () => runResolve(deps, postId, attempt, retry).catch(ignoreStop));
}

const testData = z.object({ requestId: z.string().min(1), kind: z.enum(POST_KINDS), userId: z.string().min(1) });

/** A role mention in text, with the line break after it. */
const MENTION = /<@&\d+>\n?/g;

/**
 * Sends the saved draft of a post kind to the staff test webhook as a test: the German marker is its first line, a role
 * mention is stripped, the card is the details embed, and `allowed_mentions` is `{ parse: [] }`. It stores nothing on the
 * post, never reads the bot token and never touches a Discord event. The outcome goes to a 60-second Kv key the UI reads;
 * a failure is reported there and not retried, so no test message is posted twice.
 */
export async function sendTest(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { requestId, kind } = testData.parse(raw);
  const finish = (result: { ok: true; count: number } | { ok: false; error: string }) => deps.kv.set(testResultKey(requestId, kind), JSON.stringify({ ...result, at: deps.now().toISOString() }), 60);
  if (kind === "disaster" || kind === "resolved") return finish({ ok: false, error: "A disaster or resolved message has no test send." });
  const [request] = await deps.db.select().from(eventRequest).where(eq(eventRequest.id, requestId)).limit(1);
  const [post] = await deps.db.select().from(eventPost).where(and(eq(eventPost.requestId, requestId), eq(eventPost.kind, kind), ne(eventPost.status, "deleted"))).orderBy(desc(eventPost.createdAt), desc(eventPost.id)).limit(1);
  if (!request || !post) return finish({ ok: false, error: "Write the message first." });
  const url = await loadWebhook(deps.db, "staff");
  if (!url) return finish({ ok: false, error: "The staff test webhook is not set. An admin sets it in Event settings." });
  const settings = await loadPostSettings(deps.db);
  let planned: PostPart[];
  try {
    planned = plannedParts({ kind, text: `${GERMAN.testMarker}\n\n${post.text.replace(MENTION, "")}`, embed: post.embed, pingRole: false, note: post.note }, request, settings, { discordEventUrl: null });
  } catch (error) {
    return finish({ ok: false, error: error instanceof Error ? error.message : "The message does not fit Discord." });
  }
  for (const [i, part] of planned.entries()) {
    const { body, files } = await partBody(deps.db, settings, { ...part, content: part.content.replace(MENTION, "") }, { parse: [] });
    const result = await sendMessage({ kind: "staff", url }, body, files);
    if (result.kind === "ok") continue;
    const error =
      result.kind === "retry" ? "Discord is rate-limiting the staff webhook. Try again in a moment."
      : result.kind === "gone" ? `Discord no longer accepts the staff webhook (${result.status}). An admin must set a new one.`
      : result.kind === "rejected" ? `Discord rejected test message ${i + 1} (${result.status}).`
      : result.error.message;
    return finish({ ok: false, error });
  }
  return finish({ ok: true, count: planned.length });
}

// Attempts and backoff are set where the job is enqueued (5 tries, exponential from 5 s).
registerJob(QUEUE.deliver, "events.post", (data, deps) => sendPost(deps, data));
registerJob(QUEUE.deliver, "events.edit", (data, deps) => editPostMessages(deps, data));
registerJob(QUEUE.deliver, "events.delete", (data, deps) => deletePostMessages(deps, data));
registerJob(QUEUE.deliver, "events.resolve", (data, deps) => resolveDisasterMessage(deps, data));
registerJob(QUEUE.deliver, "events.test", (data, deps) => sendTest(deps, data));
