import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { eventPost, eventUpload, user, type EventPostRow, type EventRequestRow, type PostStatus } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { countEmbedChars, LIMITS, textLength, type Embed } from "@/lib/discord-limits";
import { discordEventUrl, keepsMention, MAX_POST_TEXT, plannedParts, POST_DUE_OFFSET_DAYS, POST_KINDS, POST_TARGET, type PlanRequest, type PostKind, type PostPart } from "@/lib/event-messages";
import { dueFor } from "@/lib/event-prep-template";
import type { EmbedTemplate } from "@/lib/event-templates";
import type { Kv } from "@/lib/kv";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import { newId } from "@/lib/id";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { eventTimeZone, loadPostSettings, type PostSettings } from "./event-settings";
import { eventDayAccess, requestAccess } from "./request-access";
import { lockRequest, logRequest } from "./requests";

/** The statuses of a request in which its messages may be posted. */
export const POSTING_STATUSES: readonly string[] = ["accepted", "event_week"];

/** Whether a post of `kind` may be sent while its request is in `status`: a cancelled message belongs to a cancelled request, every other kind to a request that is accepted or in its event week. */
export const canPostKind = (kind: PostKind, status: string): boolean => (kind === "cancelled" ? status === "cancelled" : POSTING_STATUSES.includes(status));

/** How long the Kv lock of one post lives at most; a part takes at most 10 s and a post has a handful. */
export const LOCK_SECONDS = 300;
/** A `sending` post untouched for this long (the lock plus a margin) has lost its job: Resume and Delete accept it. */
export const STALE_SENDING_MS = (LOCK_SECONDS + 60) * 1000;

/** Whether `post` is `sending` and has not been written for longer than a job can hold it. */
export const isStaleSending = (post: Pick<EventPostRow, "status" | "updatedAt">, now: Date = new Date()): boolean =>
  post.status === "sending" && now.getTime() - post.updatedAt.getTime() > STALE_SENDING_MS;

const kindSchema = z.enum(POST_KINDS);

const embedSchema = z.strictObject({
  title: z.string().max(LIMITS.embedTitle),
  description: z.string().max(LIMITS.embedDescription),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #c23636."),
  imageUploadId: z.string().min(1).max(64).nullable(),
  fields: z.array(z.strictObject({ name: z.string().max(LIMITS.fieldName), value: z.string().max(LIMITS.fieldValue) })).max(LIMITS.fields),
  footer: z.string().max(LIMITS.footer),
  url: z.string().max(2000).regex(/^https:\/\/\S+$/, "Use an https link.").nullable().optional(),
  author: z.string().max(256).optional(),
});

/** Input of {@link savePostDraft}; an omitted key stays as it is. */
export const savePostDraftInput = z.strictObject({
  text: z.string().max(MAX_POST_TEXT).optional(),
  embed: embedSchema.nullable().optional(),
  pingRole: z.boolean().optional(),
  note: z.string().max(2000).nullable().optional(),
});

/** Reads `raw` with `schema`, turning a failure into an InvalidError. */
function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new InvalidError(result.error.issues.map((i) => i.message).join(" "));
  return result.data;
}

/** Throws unless `imageId` (when set) is an embed image of this request. */
async function assertEmbedImage(tx: Executor, requestId: string, imageId: string | null | undefined): Promise<void> {
  if (!imageId) return;
  const [upload] = await tx.select({ requestId: eventUpload.requestId, purpose: eventUpload.purpose }).from(eventUpload).where(eq(eventUpload.id, imageId)).limit(1);
  if (!upload || upload.requestId !== requestId || upload.purpose !== "embed") throw new InvalidError("Unknown embed image.");
}

/** The newest post of `kind` that is not deleted. */
async function livePost(tx: Executor, requestId: string, kind: PostKind): Promise<EventPostRow | undefined> {
  const [row] = await tx
    .select()
    .from(eventPost)
    .where(and(eq(eventPost.requestId, requestId), eq(eventPost.kind, kind), ne(eventPost.status, "deleted")))
    .orderBy(desc(eventPost.createdAt), desc(eventPost.id))
    .limit(1);
  return row;
}

/**
 * Creates or changes the draft of the one post of `kind`. A post that is sending, partial or posted cannot be changed here.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without edit access, ConflictError once the
 * post is sending, partial or posted, InvalidError for a role ping on a kind that never pings, a note on a post that is
 * not a resolved message, or an image that is not an embed image of this request
 */
export async function savePostDraft(db: Db, actor: Actor, requestId: string, rawKind: PostKind, raw: unknown): Promise<void> {
  const kind = parse(kindSchema, rawKind);
  const input = parse(savePostDraftInput, raw);
  if (kind === "cancelled") throw new InvalidError("A cancelled message is posted by cancelling the request.");
  if (input.pingRole && kind !== "announcement" && kind !== "reminder") throw new InvalidError("Only an announcement or a reminder can ping the event role.");
  if (input.note && kind !== "resolved") throw new InvalidError("Only a resolved message has a note.");
  await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    await lockRequest(tx, requestId);
    await assertEmbedImage(tx, requestId, input.embed?.imageUploadId);
    const existing = await livePost(tx, requestId, kind);
    const changes = {
      ...(input.text === undefined ? {} : { text: input.text }),
      ...(input.embed === undefined ? {} : { embed: input.embed }),
      ...(input.pingRole === undefined ? {} : { pingRole: input.pingRole }),
      ...(input.note === undefined ? {} : { note: input.note }),
      updatedAt: new Date(),
    };
    if (existing) {
      if (existing.status === "sending" || existing.status === "partial" || existing.status === "posted" || existing.parts.some((p) => p.messageId !== null)) {
        throw new ConflictError(`This ${kind} post is already ${existing.status}; it can no longer be changed here.`);
      }
      await tx.update(eventPost).set(changes).where(eq(eventPost.id, existing.id));
    } else {
      await tx.insert(eventPost).values({ id: newId(), requestId, kind, createdBy: actor.userId, ...changes });
    }
    await logRequest(tx, actor, { requestId, field: "post", newValue: `${kind} draft saved` });
  });
}

/** One planned message as the editor shows it: its kind and length, and whether Discord already has it. */
export interface PreviewPart {
  kind: PostPart["kind"];
  /** The text of the message; empty for an embed part. */
  content: string;
  /** Characters Discord counts: the content, or the embed's total. */
  length: number;
  sent: boolean;
  /** The embed of an embed part, so the editor can draw the card. */
  embed?: Embed;
}

/**
 * Plans the messages a saved post becomes, without calling Discord and without any secret, so the editor can show how many
 * messages it makes and how long each is. Empty while the kind has no saved post.
 *
 * @throws NotFoundError for a request the actor cannot see, InvalidError when a part would not fit Discord
 */
export async function previewPost(db: Db, actor: Actor, requestId: string, kind: PostKind): Promise<{ parts: PreviewPart[]; embeds: Embed[] }> {
  const { request } = await requestAccess(db, actor, requestId, "view");
  const post = await livePost(db, requestId, kind);
  if (!post) return { parts: [], embeds: [] };
  const settings = await loadPostSettings(db);
  const planned = plan(post, request, settings);
  const parts = planned.map((p, i): PreviewPart => ({ kind: p.kind, content: p.content, length: p.embed ? countEmbedChars(p.embed) : textLength(p.content), sent: post.parts[i]?.messageId != null, ...(p.embed ? { embed: p.embed } : {}) }));
  return { parts, embeds: parts.flatMap((p) => (p.embed ? [p.embed] : [])) };
}

/** Plans the parts of `post`, turning a part that breaks Discord's limits into an InvalidError. */
function plan(post: Parameters<typeof plannedParts>[0], request: Parameters<typeof plannedParts>[1] & Parameters<typeof discordEventUrl>[0], settings: PostSettings): PostPart[] {
  try {
    return plannedParts(post, request, settings, { discordEventUrl: discordEventUrl(request, settings) });
  } catch (error) {
    throw new InvalidError(error instanceof Error ? error.message : "The message does not fit Discord.");
  }
}

/** Checks everything a send needs besides the post itself; shared by start and resume. */
function checkReady(request: { status: string }, kind: PostKind, settings: PostSettings): void {
  const target = POST_TARGET[kind];
  if (!settings.hooks[target]) throw new ConflictError(`The ${target} webhook is not set. An admin sets it in Event settings.`);
  if (!canPostKind(kind, request.status)) throw new ConflictError(`A ${request.status} request cannot post messages.`);
}

/** Sets the post to `sending` with the next attempt, applies `set`, and logs it; returns the next attempt. */
async function beginJob(tx: Tx, actor: Actor, post: EventPostRow, set: Partial<typeof eventPost.$inferInsert>, logged: string): Promise<number> {
  const attempt = post.attempt + 1;
  await tx
    .update(eventPost)
    .set({ ...set, status: "sending", attempt, lastError: null, updatedAt: new Date() })
    .where(eq(eventPost.id, post.id));
  await logRequest(tx, actor, { requestId: post.requestId, field: "post", oldValue: post.status, newValue: logged });
  return attempt;
}

/** The status a post goes back to when its job cannot be queued: a lost (stale) `sending` post is `partial` again. */
const restoreStatus = (post: EventPostRow): PostStatus => (post.status === "sending" ? "partial" : post.status);

/** The job a click queues, and where the post goes back to when the queue is down. */
interface Queued {
  name: "events.post" | "events.edit" | "events.delete";
  data: Record<string, unknown>;
  jobId: string;
  postId: string;
  attempt: number;
  restore: { status: PostStatus; error: string; set?: Partial<typeof eventPost.$inferInsert> };
}

/** The send job of `postId`; a post that cannot be queued goes to `failed`. */
const sendJob = (postId: string, attempt: number): Queued => ({
  name: "events.post",
  data: { postId, attempt },
  jobId: `event-post-${postId}-${attempt}`,
  postId,
  attempt,
  restore: { status: "failed", error: "The post could not be queued. Try again." },
});

/** The edit job of `postId`; a post that cannot be queued goes back to `from`. */
const editJob = (postId: string, attempt: number, editVersion: number, from: PostStatus): Queued => ({
  name: "events.edit",
  data: { postId, editVersion, attempt },
  jobId: `event-edit-${postId}-${attempt}`,
  postId,
  attempt,
  restore: { status: from, error: "The edit could not be queued. Try again." },
});

/** Enqueues a job; when the queue is down the post goes back to its restore status so a click can try again. */
async function enqueue(db: Db, queue: JobQueue, job: Queued): Promise<void> {
  try {
    await addWithTimeout(queue, job.name, job.data, { jobId: job.jobId, attempts: 5, backoffMs: 5000 });
  } catch (error) {
    await db
      .update(eventPost)
      .set({ ...job.restore.set, status: job.restore.status, lastError: job.restore.error, updatedAt: new Date() })
      .where(and(eq(eventPost.id, job.postId), eq(eventPost.attempt, job.attempt), eq(eventPost.status, "sending")));
    throw error;
  }
}

/**
 * Starts posting a draft: plans its messages, stores them with no message ids, marks the post `sending` and queues the
 * `events.post` job. Returns at once; the worker sends.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without edit access
 * @throws ConflictError when the post is sending, partial, posted or already has message ids, the webhook is not set, or
 * the request is not accepted or in its event week
 * @throws InvalidError for a disaster or resolved kind (postDisaster guards the event week), without a saved post, without text (announcement, reminder), or when a message does not fit Discord
 */
export async function startPost(db: Db, actor: Actor, requestId: string, kind: PostKind, queue: JobQueue): Promise<void> {
  if (kind === "disaster" || kind === "resolved") throw new InvalidError("A disaster message is posted with the disaster panel.");
  if (kind === "cancelled") throw new InvalidError("A cancelled message is posted by cancelling the request.");
  const job = await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const request = await lockRequest(tx, requestId);
    const post = await livePost(tx, requestId, kind);
    if (!post) throw new InvalidError("Write the message first.");
    if (post.status === "sending") throw new ConflictError("This post is already being sent.");
    if (post.status === "posted") throw new ConflictError("This post is already posted.");
    if (post.status === "partial" || post.parts.some((p) => p.messageId !== null)) throw new ConflictError("Some messages of this post are already posted. Use Resume.");
    const settings = await loadPostSettings(tx);
    checkReady(request, kind, settings);
    if ((kind === "announcement" || kind === "reminder") && post.text.trim() === "") throw new InvalidError("Write the message first.");
    const parts = plan(post, request, settings);
    if (parts.length === 0) throw new InvalidError("Write the message first.");
    const attempt = await beginJob(tx, actor, post, { parts, postedBy: actor.userId }, `${kind} sending`);
    return sendJob(post.id, attempt);
  });
  await enqueue(db, queue, job);
}

/**
 * Continues a `partial` or `failed` post: messages that already have an id stay as they are; the unsent rest is planned
 * again from the current text. Queues the job with the next attempt.
 *
 * @throws ConflictError while a job is running (`sending` and written within the last six minutes; an older one lost its job and may be resumed), for a draft or posted post, an unset webhook or a request that
 * no longer posts
 */
export async function resumePost(db: Db, actor: Actor, requestId: string, kind: PostKind, queue: JobQueue): Promise<void> {
  const job = await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const request = await lockRequest(tx, requestId);
    const post = await livePost(tx, requestId, kind);
    if (!post) throw new NotFoundError(`There is no ${kind} post.`);
    const stale = isStaleSending(post);
    if (post.status === "sending" && !stale) throw new ConflictError("A job is already sending this post.");
    if (post.status !== "partial" && post.status !== "failed" && !stale) throw new ConflictError(`A ${post.status} post cannot be resumed.`);
    if (post.parts.some((p) => p.deleted)) throw new ConflictError("This post is half deleted. Delete it again to finish.");
    const settings = await loadPostSettings(tx);
    checkReady(request, kind, settings);
    // An edited post goes on with the edit job, which rebuilds its own plan.
    if (post.editVersion > 0) {
      const attempt = await beginJob(tx, actor, post, { postedBy: actor.userId }, `${kind} resumed`);
      return editJob(post.id, attempt, post.editVersion, restoreStatus(post));
    }
    const frozen = post.parts.filter((p) => p.messageId !== null);
    const planned = plan(post, request, settings);
    // The unsent tail: the text chunks after the sent ones, then the card, which is always present and last.
    const texts = planned.filter((p) => p.kind === "text").slice(frozen.filter((p) => p.kind === "text").length);
    const card = planned.at(-1)?.kind === "text" ? [] : planned.slice(-1);
    const parts = [...frozen, ...texts, ...(frozen.some((p) => p.kind !== "text") ? [] : card)];
    const attempt = await beginJob(tx, actor, post, { parts, postedBy: actor.userId }, `${kind} resumed`);
    const job = sendJob(post.id, attempt);
    // A lost `sending` post that cannot be queued stays resumable as `partial`.
    return stale ? { ...job, restore: { ...job.restore, status: restoreStatus(post) } } : job;
  });
  await enqueue(db, queue, job);
}

/** Input of {@link editPost}; an omitted key stays as it is. */
export const editPostInput = z.strictObject({
  text: z.string().max(MAX_POST_TEXT).optional(),
  embed: embedSchema.nullable().optional(),
});

/**
 * Changes the text (or card) of a posted or partly posted post and queues `events.edit`, which updates the stored Discord
 * messages in place. Editing never pings: every call of the job sends `allowed_mentions: { parse: [] }`, and a role
 * mention already in the first message stays as it is.
 *
 * @throws NotFoundError for a request the actor cannot see or a kind without a post, ForbiddenError without edit access
 * @throws ConflictError for a draft, failed, sending or half-deleted post, a post of which no message is in Discord yet, a
 * request that is not accepted or in its event week, or an unset webhook
 * @throws InvalidError for a disaster message, an image that is not an embed image of this request, or a part that does not fit Discord
 */
export async function editPost(db: Db, actor: Actor, requestId: string, rawKind: PostKind, raw: unknown, queue: JobQueue): Promise<void> {
  const kind = parse(kindSchema, rawKind);
  const input = parse(editPostInput, raw);
  const job = await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const request = await lockRequest(tx, requestId);
    if (kind === "disaster" || kind === "resolved") throw new InvalidError("A disaster message cannot be edited. Resolve it instead.");
    if (kind === "cancelled") throw new InvalidError("A cancelled message cannot be edited.");
    const post = await livePost(tx, requestId, kind);
    if (!post) throw new NotFoundError(`There is no ${kind} post.`);
    if (post.status !== "posted" && post.status !== "partial") throw new ConflictError(`A ${post.status} post cannot be edited this way.`);
    // The edit job patches stored messages; a first send that stopped before any message went out is resumed instead (it keeps the role ping).
    if (!post.parts.some((p) => p.messageId !== null)) throw new ConflictError("Nothing was posted yet; use Resume.");
    if (!POSTING_STATUSES.includes(request.status)) throw new ConflictError(`A ${request.status} request cannot post messages.`);
    if (post.parts.some((p) => p.deleted)) throw new ConflictError("This post is half deleted. Delete it again to finish.");
    const settings = await loadPostSettings(tx);
    const target = POST_TARGET[kind];
    if (!settings.hooks[target]) throw new ConflictError(`The ${target} webhook is not set. An admin sets it in Event settings.`);
    await assertEmbedImage(tx, requestId, input.embed?.imageUploadId);
    const text = input.text ?? post.text;
    const embed = input.embed === undefined ? post.embed : input.embed;
    plan({ ...post, text, embed, pingRole: keepsMention(post.parts) }, request, settings);
    const editVersion = post.editVersion + 1;
    const attempt = await beginJob(tx, actor, post, { text, embed, editVersion }, `${kind} edited`);
    return editJob(post.id, attempt, editVersion, post.status);
  });
  await enqueue(db, queue, job);
}

/**
 * Deletes the Discord messages of a posted, partly posted or failed post: queues `events.delete`, which removes each stored
 * id. A Discord scheduled event of an announcement stays; cancelling the request removes it.
 *
 * @throws NotFoundError for a request the actor cannot see or a kind without a post, ForbiddenError without edit access
 * @throws ConflictError for a post that is a draft, sending (unless its job was lost, see {@link isStaleSending}), deleted or has no message in Discord
 */
export async function deletePost(db: Db, actor: Actor, requestId: string, rawKind: PostKind, queue: JobQueue): Promise<void> {
  const kind = parse(kindSchema, rawKind);
  const job = await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    await lockRequest(tx, requestId);
    const post = await livePost(tx, requestId, kind);
    if (!post) throw new NotFoundError(`There is no ${kind} post.`);
    if (post.status !== "posted" && post.status !== "partial" && post.status !== "failed" && !isStaleSending(post)) throw new ConflictError(`A ${post.status} post cannot be deleted.`);
    if (!post.parts.some((p) => p.messageId !== null)) throw new ConflictError("This post has no messages in Discord.");
    const attempt = await beginJob(tx, actor, post, {}, `${kind} deleting`);
    return { name: "events.delete" as const, data: { postId: post.id, attempt }, jobId: `event-delete-${post.id}-${attempt}`, postId: post.id, attempt, restore: { status: restoreStatus(post), error: "The delete could not be queued. Try again." } };
  });
  await enqueue(db, queue, job);
}

/**
 * Queues a test send of the saved draft to the staff test webhook. The job marks the text as a test, drops any role mention,
 * never pings, never creates a Discord event and stores nothing on the post; its outcome is read with {@link testResult}.
 * The job id follows the draft's last change and a two-second bucket: a double click queues one job, a retest after a change or a moment later queues another.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without edit access
 * @throws InvalidError for a disaster or resolved kind or a missing draft, ConflictError without the staff webhook
 */
export async function testSend(db: Db, actor: Actor, requestId: string, rawKind: PostKind, queue: JobQueue): Promise<void> {
  const kind = parse(kindSchema, rawKind);
  if (kind === "disaster" || kind === "resolved") throw new InvalidError("A disaster or resolved message has no test send: a test would announce a problem. Use its preview.");
  if (kind === "cancelled") throw new InvalidError("A cancelled message has no test send.");
  await requestAccess(db, actor, requestId, "edit");
  const settings = await loadPostSettings(db);
  if (!settings.hooks.staff) throw new ConflictError("The staff test webhook is not set. An admin sets it in Event settings.");
  const post = await livePost(db, requestId, kind);
  if (!post || (kind !== "team" && post.text.trim() === "")) throw new InvalidError("Write the message first.");
  const bucket = Math.floor(Date.now() / 2000);
  await addWithTimeout(queue, "events.test", { requestId, kind, userId: actor.userId }, { jobId: `event-test-${requestId}-${kind}-${post.updatedAt.getTime()}-${bucket}`, attempts: 1 });
}

/** The outcome of the last test send; `at` is when the job finished. */
export type TestResult = { ok: true; count: number; at: string } | { ok: false; error: string; at: string };

/** The Kv key of a test send's result; Kv keys may hold `:`. */
export const testResultKey = (requestId: string, kind: PostKind): string => `event-test:${requestId}:${kind}`;

/**
 * Reads the result of the last test send of a post kind (kept for 60 seconds); null while there is none.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without edit access
 */
export async function testResult(kv: Kv, db: Db, actor: Actor, requestId: string, rawKind: PostKind): Promise<TestResult | null> {
  const kind = parse(kindSchema, rawKind);
  await requestAccess(db, actor, requestId, "edit");
  const raw = await kv.get(testResultKey(requestId, kind));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TestResult;
  } catch {
    return null;
  }
}

/** Whether the live announcement has at least one message in Discord: a part with a message id. */
export async function announcementInDiscord(tx: Executor, requestId: string): Promise<boolean> {
  const post = await livePost(tx, requestId, "announcement");
  return post !== undefined && post.parts.some((p) => p.messageId !== null && !p.deleted);
}

/** A `cancelled` post the cancel queued: its job, for {@link enqueuePost} after the commit. */
export type CancelledPostJob = Queued;

/**
 * Inserts the `cancelled` post of a cancel inside its transaction: only when the announcement is in Discord and the public
 * webhook is set. The caller enqueues the returned job with {@link enqueuePost} after the commit.
 *
 * @returns the job to enqueue, or null when nothing is posted
 * @throws InvalidError when the message does not fit Discord
 */
export async function insertCancelledPost(tx: Tx, actor: Actor, request: EventRequestRow, note: string): Promise<CancelledPostJob | null> {
  if (!(await announcementInDiscord(tx, request.id))) return null;
  const settings = await loadPostSettings(tx);
  if (!settings.hooks.public) return null;
  const base = { kind: "cancelled" as const, text: "", embed: null, pingRole: false, note };
  const parts = plan(base, request, settings);
  const id = newId();
  await tx.insert(eventPost).values({ id, requestId: request.id, ...base, parts, status: "sending", attempt: 1, postedBy: actor.userId, createdBy: actor.userId });
  await logRequest(tx, actor, { requestId: request.id, field: "post", newValue: "cancelled sending" });
  return sendJob(id, 1);
}

/** Queues the job of a post {@link insertCancelledPost} made; when the queue is down the post goes to `failed` so Resume can try again. */
export const enqueuePost = (db: Db, queue: JobQueue, job: CancelledPostJob): Promise<void> => enqueue(db, queue, job);

/** Input of {@link postDisaster}. */
export const postDisasterInput = z.strictObject({ note: z.string().max(1500).optional() });

/**
 * Posts the disaster message: the settings' template filled for this event (with the optional Markdown note), one embed, to the public webhook, never with a
 * ping. A disaster that failed without sending anything is replaced.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without edit access
 * @throws ConflictError outside the event week, without the public webhook, or while another disaster message is not resolved
 * @throws InvalidError for a note over 1,500 characters
 */
export async function postDisaster(db: Db, actor: Actor, requestId: string, raw: unknown, queue: JobQueue): Promise<void> {
  const input = parse(postDisasterInput, raw);
  const job = await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const request = await lockRequest(tx, requestId);
    if (request.status !== "event_week") throw new ConflictError("A disaster message can only be posted in the event week.");
    const settings = await loadPostSettings(tx);
    if (!settings.hooks.public) throw new ConflictError("The public webhook is not set. An admin sets it in Event settings.");
    const live = await tx.select().from(eventPost).where(and(eq(eventPost.requestId, requestId), eq(eventPost.kind, "disaster"), ne(eventPost.status, "deleted")));
    if (live.some((p) => p.resolvedAt === null && (p.status === "sending" || p.status === "partial" || p.status === "posted"))) {
      throw new ConflictError("A disaster message is already posted. Resolve it first.");
    }
    // A disaster that never reached Discord (failed, or a stray draft) is replaced by this one.
    for (const old of live) if (old.resolvedAt === null && old.parts.every((p) => p.messageId === null)) await tx.update(eventPost).set({ status: "deleted", updatedAt: new Date() }).where(eq(eventPost.id, old.id));
    const base = { kind: "disaster" as const, text: "", embed: null, pingRole: false, note: input.note?.trim() || null };
    const parts = plan(base, request, settings);
    const id = newId();
    await tx.insert(eventPost).values({ id, requestId, ...base, parts, status: "sending", attempt: 1, postedBy: actor.userId, createdBy: actor.userId });
    await logRequest(tx, actor, { requestId, field: "post", newValue: "disaster sending" });
    return sendJob(id, 1);
  });
  await enqueue(db, queue, job);
}

/** Input of {@link resolveDisaster}. */
export const resolveDisasterInput = z.strictObject({ note: z.string().max(1500).optional() });

/**
 * Resolves the posted disaster message: marks it resolved and creates a new `resolved` post (the resolved template with the
 * note as its one embed), which `events.post` sends. The disaster message itself stays as it was. Never pings.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without edit access
 * @throws ConflictError without a posted, unresolved disaster message, or without the public webhook
 * @throws InvalidError for a note over 1,500 characters
 */
export async function resolveDisaster(db: Db, actor: Actor, requestId: string, raw: unknown, queue: JobQueue): Promise<void> {
  const input = parse(resolveDisasterInput, raw);
  const job = await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const request = await lockRequest(tx, requestId);
    const post = await livePost(tx, requestId, "disaster");
    if (!post || post.status !== "posted" || post.resolvedAt !== null) throw new ConflictError("There is no posted disaster message to resolve.");
    const settings = await loadPostSettings(tx);
    if (!settings.hooks.public) throw new ConflictError("The public webhook is not set. An admin sets it in Event settings.");
    const now = new Date();
    const base = { kind: "resolved" as const, text: "", embed: null, pingRole: false, note: input.note?.trim() || null };
    const parts = plan(base, request, settings);
    const id = newId();
    await tx.update(eventPost).set({ resolvedAt: now, updatedAt: now }).where(eq(eventPost.id, post.id));
    await tx.insert(eventPost).values({ id, requestId, ...base, parts, status: "sending", attempt: 1, postedBy: actor.userId, createdBy: actor.userId });
    await logRequest(tx, actor, { requestId, field: "post", newValue: "resolved sending" });
    return sendJob(id, 1);
  });
  await enqueue(db, queue, job);
}

/** What the disaster panel shows. */
export interface DisasterView {
  /** Whether the actor may post and resolve (edit access) and the request is in its event week. */
  canAct: boolean;
  /** Whether the public webhook is set. */
  hookSet: boolean;
  /** The newest disaster post, if any. */
  post: { id: string; status: EventPostRow["status"]; resolvedAt: Date | null; lastError: string | null; partsCount: number; sentCount: number; stale: boolean } | null;
  /** The newest resolved message created after that disaster post, if any. */
  resolved: { id: string; status: EventPostRow["status"]; lastError: string | null; partsCount: number; sentCount: number; stale: boolean } | null;
  /** The templates the client fills (with `{note}`) for its previews; `imageUploadId` is the generic disaster image. */
  template: { disaster: EmbedTemplate; resolved: EmbedTemplate; imageUploadId: string | null };
  /** What the builders read from the request, so the client can fill the templates. */
  request: PlanRequest;
  timeZone: string;
  rulebookUrl: string | null;
}

/**
 * The state of the disaster panel and what the client needs to preview both messages itself. Sends nothing.
 *
 * @throws NotFoundError for a request the actor may not see
 */
export async function disasterView(db: Db, actor: Actor, requestId: string): Promise<DisasterView> {
  const { request, canEdit } = await eventDayAccess(db, actor, requestId);
  const settings = await loadPostSettings(db);
  const post = await livePost(db, requestId, "disaster");
  const newestResolved = post === undefined ? undefined : await livePost(db, requestId, "resolved");
  const resolved = post !== undefined && newestResolved !== undefined && newestResolved.createdAt.getTime() >= post.createdAt.getTime() ? newestResolved : undefined;
  const progress = (p: EventPostRow) => ({ id: p.id, status: p.status, lastError: p.lastError, partsCount: p.parts.length, sentCount: p.parts.filter((x) => x.messageId !== null).length, stale: isStaleSending(p) });
  const { title, startsAt, durationMinutes, where, eventDocsUrl, bannerUploadId, summary } = request;
  return {
    canAct: canEdit && request.status === "event_week",
    hookSet: settings.hooks.public,
    post: post === undefined ? null : { ...progress(post), resolvedAt: post.resolvedAt },
    resolved: resolved === undefined ? null : progress(resolved),
    template: { disaster: settings.disasterTemplate, resolved: settings.resolvedTemplate, imageUploadId: settings.disasterTemplate.imageUploadId },
    request: { title, startsAt, durationMinutes, where, eventDocsUrl, bannerUploadId, summary },
    timeZone: settings.timeZone,
    rulebookUrl: settings.rulebookUrl,
  };
}

/** A post as the Messages tab lists it. */
export interface PostView {
  id: string;
  kind: PostKind;
  status: EventPostRow["status"];
  text: string;
  embed: Embed | null;
  pingRole: boolean;
  note: string | null;
  partsCount: number;
  sentCount: number;
  lastError: string | null;
  postedAt: Date | null;
  postedByName: string | null;
  /** When the post was last written; the card adopts the server text only when this changed. */
  updatedAt: Date;
  /** When the kind is due (team, announcement, reminder, 09:00 local), from the event start. */
  dueAt: Date | null;
  /** Due date passed and not posted. */
  late: boolean;
  /** `sending` for so long that its job is lost: Resume and Delete work again. */
  stale: boolean;
}

/** The posts of a request and what the tab needs to enable its buttons. */
export interface PostsView {
  posts: PostView[];
  /** Whether the webhook of each target is set (never the webhook itself). */
  targets: { team: boolean; public: boolean; staff: boolean };
  /** Whether a ping role is configured. */
  pingRoleSet: boolean;
  /** When each timed kind is due and whether that has passed unposted, also for kinds without a post yet; null without an event start. */
  dues: Record<"team" | "announcement" | "reminder", { dueAt: Date | null; late: boolean }>;
}

/**
 * Lists the live posts of a request with their progress, due dates and a late flag (due date passed, not posted).
 *
 * @throws NotFoundError for a request the actor cannot see
 */
export async function listPosts(db: Db, actor: Actor, requestId: string, now: Date = new Date()): Promise<PostsView> {
  const { request } = await requestAccess(db, actor, requestId, "view");
  const rows = await db
    .select({ post: eventPost, postedByName: user.name })
    .from(eventPost)
    .leftJoin(user, eq(user.id, eventPost.postedBy))
    .where(and(eq(eventPost.requestId, requestId), ne(eventPost.status, "deleted")))
    .orderBy(eventPost.createdAt);
  const zone = await eventTimeZone(db);
  const settings = await loadPostSettings(db);
  const dueOf = (kind: PostKind): Date | null => {
    const offset = POST_DUE_OFFSET_DAYS[kind];
    return offset !== undefined && request.startsAt ? dueFor(request.startsAt, offset, zone) : null;
  };
  const lateOf = (kind: PostKind): boolean => {
    const dueAt = dueOf(kind);
    return dueAt !== null && dueAt.getTime() < now.getTime() && !rows.some((r) => r.post.kind === kind && r.post.status === "posted");
  };
  const due = (kind: "team" | "announcement" | "reminder") => ({ dueAt: dueOf(kind), late: lateOf(kind) });
  const posts = rows.map(({ post, postedByName }): PostView => {
    const dueAt = dueOf(post.kind);
    return {
      id: post.id,
      kind: post.kind,
      status: post.status,
      text: post.text,
      embed: post.embed,
      pingRole: post.pingRole,
      note: post.note,
      partsCount: post.parts.length,
      sentCount: post.parts.filter((p) => p.messageId !== null).length,
      lastError: post.lastError,
      postedAt: post.postedAt,
      postedByName: post.status === "posted" ? postedByName : null,
      updatedAt: post.updatedAt,
      dueAt,
      late: dueAt !== null && post.status !== "posted" && dueAt.getTime() < now.getTime(),
      stale: isStaleSending(post, now),
    };
  });
  return { posts, targets: { team: settings.hooks.team, public: settings.hooks.public, staff: settings.hooks.staff }, pingRoleSet: settings.pingRoleId !== null, dues: { team: due("team"), announcement: due("announcement"), reminder: due("reminder") } };
}
