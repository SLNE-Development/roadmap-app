import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { eventPost, eventUpload, user, type EventPostRow } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { countEmbedChars, LIMITS, textLength, type Embed } from "@/lib/discord-limits";
import { discordEventUrl, plannedParts, POST_DUE_OFFSET_DAYS, POST_KINDS, POST_TARGET, type PostKind, type PostPart } from "@/lib/event-messages";
import { dueFor } from "@/lib/event-prep-template";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import { newId } from "@/lib/id";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { eventTimeZone, loadPostSettings, type PostSettings } from "./event-settings";
import { requestAccess } from "./request-access";
import { lockRequest, logRequest } from "./requests";

/** The statuses of a request in which its messages may be posted. */
const POSTING_STATUSES: readonly string[] = ["accepted", "event_week"];

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
  text: z.string().max(20_000).optional(),
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
  if (input.pingRole && kind !== "announcement" && kind !== "reminder") throw new InvalidError("Only an announcement or a reminder can ping the event role.");
  if (input.note && kind !== "resolved") throw new InvalidError("Only a resolved message has a note.");
  await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    await lockRequest(tx, requestId);
    const imageId = input.embed?.imageUploadId;
    if (imageId) {
      const [upload] = await tx.select({ requestId: eventUpload.requestId, purpose: eventUpload.purpose }).from(eventUpload).where(eq(eventUpload.id, imageId)).limit(1);
      if (!upload || upload.requestId !== requestId || upload.purpose !== "embed") throw new InvalidError("Unknown embed image.");
    }
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
}

/**
 * Plans the messages a saved post becomes, without calling Discord and without any secret, so the editor can show how many
 * messages it makes and how long each is. Empty while the kind has no saved post.
 *
 * @throws NotFoundError for a request the actor cannot see, InvalidError when a part would not fit Discord
 */
export async function previewPost(db: Db, actor: Actor, requestId: string, kind: PostKind): Promise<{ parts: PreviewPart[] }> {
  const { request } = await requestAccess(db, actor, requestId, "view");
  const post = await livePost(db, requestId, kind);
  if (!post) return { parts: [] };
  const settings = await loadPostSettings(db);
  const planned = plan(post, request, settings);
  return { parts: planned.map((p, i) => ({ kind: p.kind, content: p.content, length: p.embed ? countEmbedChars(p.embed) : textLength(p.content), sent: post.parts[i]?.messageId != null })) };
}

/** Plans the parts of `post`, turning a part that breaks Discord's limits into an InvalidError. */
function plan(post: EventPostRow, request: Parameters<typeof plannedParts>[1] & Parameters<typeof discordEventUrl>[0], settings: PostSettings): PostPart[] {
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
  if (!POSTING_STATUSES.includes(request.status)) throw new ConflictError(`A ${request.status} request cannot post messages.`);
}

/** Writes the new parts, sets the post to `sending` with the next attempt and logs it; returns the job to enqueue. */
async function beginAttempt(tx: Tx, actor: Actor, post: EventPostRow, parts: PostPart[], logged: string): Promise<{ postId: string; attempt: number }> {
  const attempt = post.attempt + 1;
  await tx
    .update(eventPost)
    .set({ parts, status: "sending", attempt, lastError: null, postedBy: actor.userId, updatedAt: new Date() })
    .where(eq(eventPost.id, post.id));
  await logRequest(tx, actor, { requestId: post.requestId, field: "post", oldValue: post.status, newValue: logged });
  return { postId: post.id, attempt };
}

/** Enqueues the send job; when the queue is down the post goes back to `failed` so a click can try again. */
async function enqueue(db: Db, queue: JobQueue, job: { postId: string; attempt: number }): Promise<void> {
  try {
    await addWithTimeout(queue, "events.post", job, { jobId: `event-post-${job.postId}-${job.attempt}`, attempts: 5, backoffMs: 5000 });
  } catch (error) {
    await db
      .update(eventPost)
      .set({ status: "failed", lastError: "The post could not be queued. Try again.", updatedAt: new Date() })
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
 * @throws InvalidError without a saved post, without text (announcement, reminder), or when a message does not fit Discord
 */
export async function startPost(db: Db, actor: Actor, requestId: string, kind: PostKind, queue: JobQueue): Promise<void> {
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
    return beginAttempt(tx, actor, post, parts, `${kind} sending`);
  });
  await enqueue(db, queue, job);
}

/**
 * Continues a `partial` or `failed` post: messages that already have an id stay as they are; the unsent rest is planned
 * again from the current text. Queues the job with the next attempt.
 *
 * @throws ConflictError while a job is running (`sending`), for a draft or posted post, an unset webhook or a request that
 * no longer posts
 */
export async function resumePost(db: Db, actor: Actor, requestId: string, kind: PostKind, queue: JobQueue): Promise<void> {
  const job = await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const request = await lockRequest(tx, requestId);
    const post = await livePost(tx, requestId, kind);
    if (!post) throw new NotFoundError(`There is no ${kind} post.`);
    if (post.status === "sending") throw new ConflictError("A job is already sending this post.");
    if (post.status !== "partial" && post.status !== "failed") throw new ConflictError(`A ${post.status} post cannot be resumed.`);
    const settings = await loadPostSettings(tx);
    checkReady(request, kind, settings);
    const frozen = post.parts.filter((p) => p.messageId !== null);
    const planned = plan(post, request, settings);
    // The unsent tail: the text chunks after the sent ones, then the card, which is always present and last.
    const texts = planned.filter((p) => p.kind === "text").slice(frozen.filter((p) => p.kind === "text").length);
    const card = planned.at(-1)?.kind === "text" ? [] : planned.slice(-1);
    const parts = [...frozen, ...texts, ...(frozen.some((p) => p.kind !== "text") ? [] : card)];
    return beginAttempt(tx, actor, post, parts, `${kind} resumed`);
  });
  await enqueue(db, queue, job);
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
  /** When the kind is due (team, announcement, reminder, 09:00 local), from the event start. */
  dueAt: Date | null;
  /** Due date passed and not posted. */
  late: boolean;
}

/** The posts of a request and what the tab needs to enable its buttons. */
export interface PostsView {
  posts: PostView[];
  /** Whether the webhook of each target is set (never the webhook itself). */
  targets: { team: boolean; public: boolean };
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
      dueAt,
      late: dueAt !== null && post.status !== "posted" && dueAt.getTime() < now.getTime(),
    };
  });
  return { posts, targets: { team: settings.hooks.team, public: settings.hooks.public }, pingRoleSet: settings.pingRoleId !== null, dues: { team: due("team"), announcement: due("announcement"), reminder: due("reminder") } };
}
