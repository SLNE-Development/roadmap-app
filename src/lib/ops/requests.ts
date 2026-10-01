import { and, asc, count, desc, eq, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { eventBriefVersion, eventQuestion, eventRequest, eventTodo, project, projectMember, requestLog, user, type EventRequestRow } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { diffDocuments, type DiffHunk } from "@/lib/diff";
import { canTransition, isOpen, REQUEST_STATUSES, type RequestStatus } from "@/lib/event-status";
import { newId } from "@/lib/id";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import { logChange } from "./log";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { botConfigured, discordEventState, type DiscordEventState } from "./event-settings";
import { briefAudienceIds, developerIds, notifyRequest } from "./request-notify";
import { canAcceptRequests, canDevelop, eventFlags, requestAccess, type RequestAccess, type RequestRole } from "./request-access";
import { enqueuePost, insertCancelledPost, type CancelledPostJob } from "./request-posts";
import { ensurePrepTodos, fallbackReady, redateTodos, seedRequestDefaults } from "./request-setup";

/** One change to a request's history: which field changed, from what to what. Never holds secrets. */
export interface RequestLogEntry {
  requestId: string;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
}

/** Appends `entry` to the request log, attributed to the actor and their agent. `db` is the database or the transaction the change happens in. */
export async function logRequest(db: Executor, actor: Actor, entry: RequestLogEntry): Promise<void> {
  await db.insert(requestLog).values({
    requestId: entry.requestId,
    field: entry.field,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    authorUserId: actor.userId,
    agent: actor.agent ?? null,
  });
}

/** A date as a `Date` or an ISO string. */
const dateSchema = z.union([z.date(), z.string().datetime({ offset: true })]).transform((v) => new Date(v));

const titleSchema = z.string().trim().min(1).max(120);
const durationSchema = z.number().int().min(5).max(10080);
const whereSchema = z.string().trim().max(200);
const summarySchema = z.string().trim().max(500);
const docsUrlSchema = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((v) => v.startsWith("https://"), "must be an https URL");
const briefSchema = z.string().max(50_000);

/** Input of {@link createRequest}. */
export const createRequestInput = z.object({
  title: titleSchema,
  startsAt: dateSchema.optional(),
  durationMinutes: durationSchema.optional(),
  where: whereSchema.optional(),
  eventDocsUrl: docsUrlSchema.nullable().optional(),
  brief: briefSchema,
  requesterId: z.string().min(1).optional(),
});

/** Input of {@link updateRequest}; every field is optional and `null` clears the optional ones. */
export const updateRequestInput = z.object({
  title: titleSchema.optional(),
  startsAt: dateSchema.nullable().optional(),
  durationMinutes: durationSchema.nullable().optional(),
  endsAt: dateSchema.nullable().optional(),
  where: whereSchema.optional(),
  summary: summarySchema.optional(),
  eventDocsUrl: docsUrlSchema.nullable().optional(),
  requesterId: z.string().min(1).optional(),
});

/** Input of {@link saveBrief}. */
export const saveBriefInput = z.object({ body: briefSchema, baseVersion: z.number().int().min(0) });

/** The reason of a cancel. */
const reasonSchema = z.string().trim().min(1).max(1000);

/** Normalizes a brief for storing and comparing: `\r\n` to `\n`, outer whitespace removed. */
function normalizeBrief(body: string): string {
  return body.replace(/\r\n/g, "\n").trim();
}

/** The current brief text of a request; version 0 has no row and reads as empty. */
async function currentBrief(db: Executor, request: Pick<EventRequestRow, "id" | "briefVersion">): Promise<string> {
  if (request.briefVersion === 0) return "";
  const [row] = await db
    .select({ body: eventBriefVersion.body })
    .from(eventBriefVersion)
    .where(and(eq(eventBriefVersion.requestId, request.id), eq(eventBriefVersion.version, request.briefVersion)));
  return row?.body ?? "";
}

/** The end of an event for display: start plus duration, null without either. */
export function endsAtOf(request: Pick<EventRequestRow, "startsAt" | "durationMinutes">): Date | null {
  return request.durationMinutes === null ? null : eventEnd(request);
}

/** The end of an event: its start plus its duration, or the start alone without a duration; null without a start. */
export function eventEnd(request: Pick<EventRequestRow, "startsAt" | "durationMinutes">): Date | null {
  if (!request.startsAt) return null;
  return new Date(request.startsAt.getTime() + (request.durationMinutes ?? 0) * 60_000);
}

/**
 * Side effects of a changed event date or duration: the linked project's deadline follows the event end (the Discord event
 * joins later) and the template to-dos that were not done or dated by hand follow the new start. `before` holds the values from before the change.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function onDateChanged(tx: Tx, actor: Actor, request: EventRequestRow, before: { startsAt: Date | null; durationMinutes: number | null }): Promise<void> {
  await redateTodos(tx, request);
  if (request.status === "accepted" || request.status === "event_week") await ensurePrepTodos(tx, request, request.acceptedBy ?? actor.userId);
  const end = eventEnd(request);
  if (!request.projectId || !end) return;
  const [current] = await tx.select({ deadline: project.deadline }).from(project).where(eq(project.id, request.projectId));
  if (!current || current.deadline?.getTime() === end.getTime()) return;
  await tx.update(project).set({ deadline: end }).where(eq(project.id, request.projectId));
  await logChange(tx, actor, { projectId: request.projectId, entity: "project", entityId: request.projectId, field: "deadline", oldValue: stamp(current.deadline), newValue: stamp(end) });
}

/**
 * Queues the job that brings the request's Discord event in line (`update`) or removes it (`delete`), once the change is
 * committed. Only a request with a stored event id on a server with a bot token and guild id has one; the job id follows
 * the request's last change, so every saved change queues its own job (completed jobs are kept, a minute bucket would drop a second edit). A queue that is down never fails the change that was already saved: the event is brought in line by the
 * next change.
 */
export async function queueDiscordEventSync(db: Db, queue: JobQueue | undefined, request: Pick<EventRequestRow, "id" | "discordEventId" | "updatedAt">, action: "update" | "delete"): Promise<void> {
  if (!queue || !request.discordEventId || !(await botConfigured(db))) return;
  try {
    await addWithTimeout(queue, "events.discord-event", { requestId: request.id, action }, { jobId: `event-dev-${request.id}-${action}-${request.updatedAt.getTime()}`, attempts: 3, backoffMs: 10_000 });
  } catch (error) {
    console.error(`could not queue the Discord event ${action} of request ${request.id}: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

/** Locks the request row for the rest of the transaction so concurrent writes queue up. */
export async function lockRequest(tx: Tx, requestId: string): Promise<EventRequestRow> {
  const [row] = await tx.select().from(eventRequest).where(eq(eventRequest.id, requestId)).for("update").limit(1);
  if (!row) throw new NotFoundError(`Unknown request ${requestId}.`);
  return row;
}

/**
 * Edit access that tells a requester of a closed request apart from a view-only actor:
 * the first gets a ConflictError (it is over), the second a ForbiddenError.
 */
async function editAccess(tx: Tx, actor: Actor, requestId: string): Promise<RequestAccess> {
  const view = await requestAccess(tx, actor, requestId, "view");
  if (view.role === "requester" && !view.canEdit && !isOpen(view.request.status)) {
    throw new ConflictError(`A ${view.request.status} request can no longer be changed.`);
  }
  return requestAccess(tx, actor, requestId, "edit");
}

/** Access for cancelling and reopening a cancelled request: event managers and admins, or developers (see {@link requestAccess}). */
export async function manageOrDevelop(tx: Executor, actor: Actor, requestId: string): Promise<RequestAccess> {
  try {
    return await requestAccess(tx, actor, requestId, "manage");
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
    return requestAccess(tx, actor, requestId, "develop");
  }
}

/** Formats a date for the log. */
const stamp = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Creates a draft request; a non-empty brief is stored as version 1, an empty one leaves the version at 0. Event managers and admins only; the requester
 * defaults to the actor and may be another provisioned user.
 *
 * @throws ForbiddenError for anyone else
 * @throws InvalidError for an unknown requester
 */
export async function createRequest(db: Db, actor: Actor, raw: unknown): Promise<EventRequestRow> {
  const input = createRequestInput.parse(raw);
  const flags = await eventFlags(db, actor);
  if (!flags.isAdmin && !flags.isEventManager) throw new ForbiddenError("Only event managers can create requests.");
  const requesterId = input.requesterId ?? actor.userId;
  return db.transaction(async (tx) => {
    if (requesterId !== actor.userId) {
      const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.id, requesterId)).limit(1);
      if (!found) throw new InvalidError("Unknown requester.");
    }
    const [row] = await tx
      .insert(eventRequest)
      .values({
        id: newId(),
        requesterId,
        title: input.title,
        startsAt: input.startsAt ?? null,
        durationMinutes: input.durationMinutes ?? null,
        where: input.where ?? "",
        eventDocsUrl: input.eventDocsUrl ?? null,
      })
      .returning();
    const brief = normalizeBrief(input.brief);
    let created = row;
    if (brief !== "") {
      await tx.insert(eventBriefVersion).values({ requestId: row.id, version: 1, body: brief, authorUserId: actor.userId });
      [created] = await tx.update(eventRequest).set({ briefVersion: 1 }).where(eq(eventRequest.id, row.id)).returning();
    }
    await seedRequestDefaults(tx, row.id);
    await logRequest(tx, actor, { requestId: row.id, field: "created", newValue: row.title });
    return created;
  });
}

/**
 * Changes fields of a request and logs one row per changed field. Requesters edit their open requests, managers and admins
 * every request (also closed ones); only managers change the requester. A past date is refused once the request is submitted.
 * A changed title, date, duration, place, short description or docs link queues one `events.discord-event` update when the request has a Discord
 * event, after the change is committed; without a `queue` nothing is queued.
 *
 * @throws ForbiddenError, ConflictError (closed request), InvalidError
 */
export async function updateRequest(db: Db, actor: Actor, requestId: string, raw: unknown, queue?: JobQueue): Promise<EventRequestRow> {
  const input = updateRequestInput.parse(raw);
  let onEvent = false;
  const saved = await db.transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const { request, flags } = await editAccess(tx, actor, requestId);
    const manager = flags.isAdmin || flags.isEventManager;
    if (input.requesterId !== undefined && !manager) throw new ForbiddenError("Only event managers can change the requester.");
    if (input.requesterId !== undefined && input.requesterId !== request.requesterId) {
      const [found] = await tx.select({ id: user.id }).from(user).where(eq(user.id, input.requesterId)).limit(1);
      if (!found) throw new InvalidError("Unknown requester.");
    }
    const changes: { field: string; column: Partial<typeof eventRequest.$inferInsert>; oldValue: string | null; newValue: string | null }[] = [];
    const note = (field: string, column: Partial<typeof eventRequest.$inferInsert>, oldValue: string | null, newValue: string | null) => {
      if (oldValue !== newValue) changes.push({ field, column, oldValue, newValue });
    };
    if (input.title !== undefined) note("title", { title: input.title }, request.title, input.title);
    if (input.startsAt !== undefined) {
      if (input.startsAt === null && request.status !== "draft") throw new InvalidError("An event date is required once a request is submitted.");
      if (input.startsAt && stamp(input.startsAt) !== stamp(request.startsAt) && input.startsAt.getTime() < Date.now() && (request.status === "submitted" || request.status === "accepted" || request.status === "event_week")) {
        throw new InvalidError("The event date must be in the future.");
      }
      note("startsAt", { startsAt: input.startsAt }, stamp(request.startsAt), stamp(input.startsAt));
    }
    let duration = input.durationMinutes;
    if (input.endsAt !== undefined) {
      if (input.durationMinutes !== undefined) throw new InvalidError("Give either an end or a duration, not both.");
      if (input.endsAt === null) duration = null;
      else {
        const start = input.startsAt !== undefined ? input.startsAt : request.startsAt;
        if (!start) throw new InvalidError("Set the start first.");
        if (input.endsAt.getTime() <= start.getTime()) throw new InvalidError("The end must be after the start.");
        duration = Math.round((input.endsAt.getTime() - start.getTime()) / 60_000);
        if (duration > 10080) throw new InvalidError("An event lasts at most 7 days.");
      }
    }
    if (duration !== undefined) {
      note("durationMinutes", { durationMinutes: duration }, request.durationMinutes?.toString() ?? null, duration?.toString() ?? null);
    }
    if (input.where !== undefined) note("where", { where: input.where }, request.where, input.where);
    if (input.summary !== undefined) note("summary", { summary: input.summary }, request.summary, input.summary);
    if (input.eventDocsUrl !== undefined) note("eventDocsUrl", { eventDocsUrl: input.eventDocsUrl }, request.eventDocsUrl, input.eventDocsUrl);
    if (input.requesterId !== undefined) note("requesterId", { requesterId: input.requesterId }, request.requesterId, input.requesterId);
    if (changes.length === 0) return request;
    const [updated] = await tx
      .update(eventRequest)
      .set({ ...Object.assign({}, ...changes.map((c) => c.column)), updatedAt: new Date() })
      .where(eq(eventRequest.id, requestId))
      .returning();
    for (const c of changes) await logRequest(tx, actor, { requestId, field: c.field, oldValue: c.oldValue, newValue: c.newValue });
    if (changes.some((c) => c.field === "startsAt" || c.field === "durationMinutes")) {
      await onDateChanged(tx, actor, updated, { startsAt: request.startsAt, durationMinutes: request.durationMinutes });
    }
    onEvent = changes.some((c) => EVENT_FIELDS.includes(c.field));
    return updated;
  });
  if (onEvent) await queueDiscordEventSync(db, queue, saved, "update");
  return saved;
}

/** The request fields the Discord event shows. */
const EVENT_FIELDS = ["title", "startsAt", "durationMinutes", "where", "summary", "eventDocsUrl"];

/** The statuses in which the brief can be edited. */
const BRIEF_EDITABLE: readonly RequestStatus[] = ["draft", "submitted", "accepted", "event_week"];

/**
 * Saves the brief as the next version, unless the text is unchanged (then nothing is written).
 *
 * @throws ConflictError when `baseVersion` is not the current version or the request is closed
 */
export async function saveBrief(db: Db, actor: Actor, requestId: string, raw: unknown): Promise<{ version: number; changed: boolean }> {
  const input = saveBriefInput.parse(raw);
  return db.transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const { request } = await editAccess(tx, actor, requestId);
    if (!BRIEF_EDITABLE.includes(request.status)) throw new ConflictError(`A ${request.status} request can no longer be changed.`);
    if (input.baseVersion !== request.briefVersion) throw new ConflictError("The brief changed in the meantime. Reload and merge your edits.");
    const body = normalizeBrief(input.body);
    if (request.briefVersion > 0 && normalizeBrief(await currentBrief(tx, request)) === body) return { version: request.briefVersion, changed: false };
    const version = request.briefVersion + 1;
    await tx.insert(eventBriefVersion).values({ requestId, version, body, authorUserId: actor.userId });
    await tx.update(eventRequest).set({ briefVersion: version, updatedAt: new Date() }).where(eq(eventRequest.id, requestId));
    await logRequest(tx, actor, { requestId, field: "brief", oldValue: `v${request.briefVersion}`, newValue: `v${version}` });
    if (request.status === "accepted" || request.status === "event_week") {
      await notifyRequest(tx, {
        requestId,
        kind: "request.brief_changed",
        userIds: await briefAudienceIds(tx, request),
        title: { key: "requestBriefChanged", values: { title: request.title } },
        sourceKey: `req:${requestId}:brief:${version}`,
        tab: "brief",
        actor,
      });
    }
    return { version, changed: true };
  });
}

/** A stored version of a brief. */
export interface BriefView extends AuthorFields {
  version: number;
  body: string;
  createdAt: Date;
}

/**
 * Returns a version of the brief (the current one when `version` is omitted).
 *
 * @throws NotFoundError for an unknown request or version
 */
export async function getBrief(db: Db, actor: Actor, requestId: string, version?: number): Promise<BriefView> {
  const { request } = await requestAccess(db, actor, requestId, "view");
  const wanted = version ?? request.briefVersion;
  if (wanted === 0) return { version: 0, body: "", createdAt: request.createdAt, ...authorFields(null, null) };
  const [row] = await db
    .select({ body: eventBriefVersion.body, createdAt: eventBriefVersion.createdAt, authorName: user.name })
    .from(eventBriefVersion)
    .leftJoin(user, eq(user.id, eventBriefVersion.authorUserId))
    .where(and(eq(eventBriefVersion.requestId, requestId), eq(eventBriefVersion.version, wanted)))
    .limit(1);
  if (!row) throw new NotFoundError(`The request has no brief version ${wanted}.`);
  return { version: wanted, body: row.body, createdAt: row.createdAt, ...authorFields(row.authorName, null) };
}

/** Lists the brief versions, newest first. */
export async function listBriefVersions(db: Db, actor: Actor, requestId: string): Promise<{ version: number; authorName: string | null; createdAt: Date }[]> {
  await requestAccess(db, actor, requestId, "view");
  const rows = await db
    .select({ version: eventBriefVersion.version, createdAt: eventBriefVersion.createdAt, authorName: user.name })
    .from(eventBriefVersion)
    .leftJoin(user, eq(user.id, eventBriefVersion.authorUserId))
    .where(eq(eventBriefVersion.requestId, requestId))
    .orderBy(desc(eventBriefVersion.version));
  return rows.map((r) => ({ version: r.version, authorName: r.authorName?.trim() || null, createdAt: r.createdAt }));
}

/**
 * Compares two brief versions line by line.
 *
 * @throws InvalidError unless `from` is lower than `to`
 */
export async function compareBriefs(db: Db, actor: Actor, requestId: string, from: number, to: number): Promise<{ hunks: DiffHunk[]; added: number; removed: number }> {
  await requestAccess(db, actor, requestId, "view");
  if (from >= to) throw new InvalidError("from must be lower than to.");
  const [older, newer] = await Promise.all([getBrief(db, actor, requestId, from), getBrief(db, actor, requestId, to)]);
  return diffDocuments(older.body, newer.body);
}

/** Moves a locked request to `to` after checking the lifecycle, and logs the status change. */
export async function moveTo(tx: Tx, actor: Actor, request: EventRequestRow, to: RequestStatus, extra: Partial<typeof eventRequest.$inferInsert> = {}, logged: string = to): Promise<EventRequestRow> {
  if (!canTransition(request.status, to)) throw new ConflictError(`A ${request.status} request cannot become ${to}.`);
  const [row] = await tx
    .update(eventRequest)
    .set({ status: to, updatedAt: new Date(), ...extra })
    .where(eq(eventRequest.id, request.id))
    .returning();
  await logRequest(tx, actor, { requestId: request.id, field: "status", oldValue: request.status, newValue: logged });
  return row;
}

/** Runs a status change in one transaction: lock, check access with `access`, then `change`. */
async function transition(
  db: Db,
  actor: Actor,
  requestId: string,
  access: (tx: Tx) => Promise<RequestAccess>,
  change: (tx: Tx, request: EventRequestRow) => Promise<EventRequestRow>,
): Promise<EventRequestRow> {
  return db.transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const { request } = await access(tx);
    return change(tx, request);
  });
}

/**
 * Submits a draft: it needs a title, an event date in the future and a brief.
 *
 * @throws ConflictError unless the request is a draft
 * @throws InvalidError listing what is missing
 */
export function submitRequest(db: Db, actor: Actor, requestId: string): Promise<EventRequestRow> {
  return transition(db, actor, requestId, (tx) => editAccess(tx, actor, requestId), async (tx, request) => {
    if (!canTransition(request.status, "submitted")) throw new ConflictError(`A ${request.status} request cannot become submitted.`);
    const brief = await currentBrief(tx, request);
    const missing: string[] = [];
    if (!request.title.trim()) missing.push("title");
    if (!request.startsAt) missing.push("event date");
    else if (request.startsAt.getTime() <= Date.now()) missing.push("event date in the future");
    if (!brief.trim()) missing.push("brief");
    if (missing.length > 0) throw new InvalidError(`The request cannot be submitted yet. It needs: ${missing.join(", ")}.`);
    const submitted = await moveTo(tx, actor, request, "submitted", { submittedAt: new Date() });
    // A recall and a new submission count as a new notice: the number of submissions is part of the source.
    const [{ n }] = await tx
      .select({ n: count() })
      .from(requestLog)
      .where(and(eq(requestLog.requestId, requestId), eq(requestLog.field, "status"), eq(requestLog.newValue, "submitted")));
    await notifyRequest(tx, {
      requestId,
      kind: "request.submitted",
      userIds: await developerIds(tx),
      title: { key: "requestSubmitted", values: { title: submitted.title } },
      sourceKey: `req:${requestId}:submitted:${n}`,
      actor,
    });
    return submitted;
  });
}

/** Takes a submitted request back to a draft. */
export function recallRequest(db: Db, actor: Actor, requestId: string): Promise<EventRequestRow> {
  return transition(db, actor, requestId, (tx) => editAccess(tx, actor, requestId), (tx, request) => moveTo(tx, actor, request, "draft"));
}

/** Withdraws a draft or submitted request. */
export function withdrawRequest(db: Db, actor: Actor, requestId: string): Promise<EventRequestRow> {
  return transition(db, actor, requestId, (tx) => editAccess(tx, actor, requestId), (tx, request) => moveTo(tx, actor, request, "withdrawn"));
}

/** Input of {@link cancelRequest}: the reason, 1 to 1,000 characters. */
export const cancelRequestInput = z.object({ reason: reasonSchema });

/**
 * Cancels an accepted or event-week request; managers, admins and developers only. The reason is stored as `cancelNote` and
 * is the log's new value. When the announcement is in Discord and the public webhook is set, a `cancelled` post is created
 * in the same transaction and `events.post` queued after the commit. A request with a Discord event queues
 * `events.discord-event` to delete it.
 *
 * @throws InvalidError for a missing or too long reason
 * @throws ConflictError unless the request is accepted or in its event week (a cancelled request cannot be cancelled again)
 */
export async function cancelRequest(db: Db, actor: Actor, requestId: string, raw: unknown, queue?: JobQueue): Promise<EventRequestRow> {
  const parsed = cancelRequestInput.safeParse(raw);
  if (!parsed.success) throw new InvalidError(parsed.error.issues.map((i) => i.message).join(" "));
  const { reason } = parsed.data;
  const queued: { job: CancelledPostJob | null } = { job: null };
  const cancelled = await transition(db, actor, requestId, (tx) => manageOrDevelop(tx, actor, requestId), async (tx, request) => {
    const moved = await moveTo(tx, actor, request, "cancelled", { cancelNote: reason }, reason);
    queued.job = await insertCancelledPost(tx, actor, moved, reason);
    return moved;
  });
  if (queued.job && queue) await enqueuePost(db, queue, queued.job);
  await queueDiscordEventSync(db, queue, cancelled, "delete");
  return cancelled;
}

/**
 * Starts the event week of an accepted request. Edit or develop access; the required fallback scenario must be
 * filled in. Nothing starts it on a date.
 *
 * @throws ConflictError unless the request is accepted, or while a required scenario is incomplete (the message names them)
 * @throws ForbiddenError without edit or develop access
 */
export function startEventWeek(db: Db, actor: Actor, requestId: string): Promise<EventRequestRow> {
  const access = async (tx: Tx) => {
    try {
      return await requestAccess(tx, actor, requestId, "edit");
    } catch (e) {
      if (!(e instanceof ForbiddenError)) throw e;
      return requestAccess(tx, actor, requestId, "develop");
    }
  };
  return transition(db, actor, requestId, access, async (tx, request) => {
    if (!canTransition(request.status, "event_week")) throw new ConflictError(`A ${request.status} request cannot become event_week.`);
    const ready = await fallbackReady(tx, requestId);
    if (!ready.ready) {
      const list = ready.missing.map((m) => `${m.title} (${m.missing.join(", ")})`).join("; ");
      throw new ConflictError(`The fallback plan is not complete yet. Missing: ${list}.`);
    }
    return moveTo(tx, actor, request, "event_week");
  });
}

/** Marks an event-week request as done. */
export function markDone(db: Db, actor: Actor, requestId: string): Promise<EventRequestRow> {
  return transition(db, actor, requestId, (tx) => editAccess(tx, actor, requestId), (tx, request) => moveTo(tx, actor, request, "done"));
}

/** What {@link listRequests} narrows to. */
export interface RequestFilter {
  status?: RequestStatus[];
  mine?: boolean;
  scope?: "open" | "all";
}

/** One row of the request list. */
export interface RequestListItem {
  id: string;
  title: string;
  status: RequestStatus;
  startsAt: Date | null;
  /** The end of the event; null without a duration. */
  endsAt: Date | null;
  requesterId: string | null;
  requesterName: string | null;
  projectSlug: string | null;
  briefVersion: number;
  /** Who accepted the request; null before. */
  acceptedBy: string | null;
  submittedAt: Date | null;
  /** Whether questions of the team wait for an answer. */
  waitingOnRequester: boolean;
  /** How many undone to-dos are past their due date. */
  lateTodos: number;
  /** Whether the request waits on the actor: open questions for its requester, a submitted one for a developer, or a late to-do the actor owns. */
  needsActor: boolean;
}

const OPEN_STATUSES = REQUEST_STATUSES.filter(isOpen);

/**
 * Lists requests the actor may see: managers and admins all, developers the submitted ones plus their own, everyone else
 * their own (drafts included). Open requests come first, then by event date with undated ones last.
 */
export async function listRequests(db: Db, actor: Actor, filter: RequestFilter = {}): Promise<RequestListItem[]> {
  const flags = await eventFlags(db, actor);
  const own = eq(eventRequest.requesterId, actor.userId);
  const conditions: (SQL | undefined)[] = [];
  if (!flags.isAdmin && !flags.isEventManager) conditions.push(flags.isEventDeveloper ? or(own, ne(eventRequest.status, "draft")) : own);
  if (filter.mine) conditions.push(own);
  if (filter.status && filter.status.length > 0) conditions.push(inArray(eventRequest.status, filter.status));
  if (filter.scope === "open") conditions.push(inArray(eventRequest.status, OPEN_STATUSES));
  const rows = await db
    .select({
      id: eventRequest.id,
      title: eventRequest.title,
      status: eventRequest.status,
      startsAt: eventRequest.startsAt,
      durationMinutes: eventRequest.durationMinutes,
      briefVersion: eventRequest.briefVersion,
      requesterId: eventRequest.requesterId,
      acceptedBy: eventRequest.acceptedBy,
      submittedAt: eventRequest.submittedAt,
      requesterName: user.name,
      projectSlug: project.slug,
    })
    .from(eventRequest)
    .leftJoin(user, eq(user.id, eventRequest.requesterId))
    .leftJoin(project, eq(project.id, eventRequest.projectId))
    .where(and(...conditions))
    .orderBy(
      sql`case when ${inArray(eventRequest.status, OPEN_STATUSES)} then 0 else 1 end`,
      asc(eventRequest.startsAt),
      asc(eventRequest.createdAt),
    );
  const waiting = new Set(
    rows.length === 0
      ? []
      : (
          await db
            .selectDistinct({ requestId: eventQuestion.requestId })
            .from(eventQuestion)
            .where(and(inArray(eventQuestion.requestId, rows.map((r) => r.id)), isNull(eventQuestion.answeredAt)))
        ).map((r) => r.requestId),
  );
  const lateIds = rows.filter((r) => r.status === "accepted" || r.status === "event_week").map((r) => r.id);
  const late = new Map(
    lateIds.length === 0
      ? []
      : (
          await db
            .select({ requestId: eventTodo.requestId, n: count(), mine: count(sql`case when ${eventTodo.ownerUserId} = ${actor.userId} then 1 end`) })
            .from(eventTodo)
            .where(and(inArray(eventTodo.requestId, lateIds), isNull(eventTodo.doneAt), lt(eventTodo.dueAt, new Date())))
            .groupBy(eventTodo.requestId)
        ).map((r) => [r.requestId, r] as const),
  );
  return rows.map(({ durationMinutes, ...r }) => ({
    ...r,
    endsAt: endsAtOf({ startsAt: r.startsAt, durationMinutes }),
    requesterName: r.requesterName?.trim() || null,
    waitingOnRequester: waiting.has(r.id),
    lateTodos: late.get(r.id)?.n ?? 0,
    needsActor:
      (waiting.has(r.id) && r.requesterId === actor.userId) || (flags.isEventDeveloper && r.status === "submitted") || (late.get(r.id)?.mine ?? 0) > 0,
  }));
}

/** Whether a request in `status` may be deleted by an actor who is staff (manager or admin) or the requester of it. */
export function canDeleteRequest(status: RequestStatus, staff: boolean, requester: boolean): boolean {
  if (staff) return status === "draft" || status === "submitted" || status === "withdrawn" || status === "cancelled";
  return requester && (status === "draft" || status === "withdrawn");
}

/** A request with what its page needs. */
export interface RequestDetail {
  request: EventRequestRow & { endsAt: Date | null };
  requesterName: string | null;
  projectSlug: string | null;
  /** The current brief. */
  brief: string;
  canEdit: boolean;
  /** Whether the actor is an event manager or admin. */
  canManage: boolean;
  /** Whether the actor may cancel the request (managers, admins, developers). */
  canCancel: boolean;
  /** Whether the actor may reopen the request: a cancelled one with manage or develop access, a withdrawn one with edit access or as its requester. */
  canReopen: boolean;
  /** Whether the actor may delete the request: managers and admins in draft, submitted, withdrawn or cancelled; the requester in their own draft or withdrawn one. */
  canDelete: boolean;
  /** Whether the actor may accept the request (admins and event developers). */
  canAccept: boolean;
  /** Whether the actor has develop access (see {@link canDevelop}). */
  canDevelop: boolean;
  /** Whether the actor may open the linked project (a member or an admin). */
  projectOpen: boolean;
  role: RequestRole;
  /** Where the request's Discord event stands. */
  discordEvent: DiscordEventState;
}

/**
 * Returns a request with its requester, current brief and the actor's rights.
 *
 * @throws NotFoundError when the actor may not see it
 */
export async function getRequest(db: Db, actor: Actor, requestId: string): Promise<RequestDetail> {
  const { request, role, canEdit, flags } = await requestAccess(db, actor, requestId, "view");
  const [brief, [owner], [linked], [membership]] = await Promise.all([
    currentBrief(db, request),
    request.requesterId ? db.select({ name: user.name }).from(user).where(eq(user.id, request.requesterId)) : Promise.resolve([]),
    request.projectId ? db.select({ slug: project.slug }).from(project).where(eq(project.id, request.projectId)) : Promise.resolve([]),
    request.projectId ? db.select({ role: projectMember.role }).from(projectMember).where(and(eq(projectMember.projectId, request.projectId), eq(projectMember.userId, actor.userId))) : Promise.resolve([]),
  ]);
  const canManage = flags.isAdmin || flags.isEventManager;
  return {
    request: { ...request, endsAt: endsAtOf(request) },
    requesterName: owner?.name?.trim() || null,
    projectSlug: linked?.slug ?? null,
    brief,
    canEdit,
    canManage,
    canCancel: canManage || flags.isEventDeveloper,
    canReopen: request.status === "cancelled" ? canManage || flags.isEventDeveloper : request.status === "withdrawn" && (canEdit || role === "requester"),
    canDelete: canDeleteRequest(request.status, canManage, request.requesterId === actor.userId),
    canAccept: canAcceptRequests(flags),
    canDevelop: await canDevelop(db, actor, requestId),
    projectOpen: linked !== undefined && (membership !== undefined || flags.isAdmin),
    role,
    discordEvent: await discordEventState(db, request),
  };
}

/** One row of a request's history. */
export interface RequestHistoryItem extends AuthorFields {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
}

/** Returns the history of a request, newest first (at most `limit`, 100 by default). */
export async function requestHistory(db: Db, actor: Actor, requestId: string, limit = 100): Promise<RequestHistoryItem[]> {
  await requestAccess(db, actor, requestId, "view");
  const rows = await db
    .select({
      id: requestLog.id,
      field: requestLog.field,
      oldValue: requestLog.oldValue,
      newValue: requestLog.newValue,
      createdAt: requestLog.createdAt,
      agent: requestLog.agent,
      authorName: user.name,
    })
    .from(requestLog)
    .leftJoin(user, eq(user.id, requestLog.authorUserId))
    .where(eq(requestLog.requestId, requestId))
    .orderBy(desc(requestLog.id))
    .limit(Math.min(Math.max(limit, 1), 500));
  return rows.map(({ agent, authorName, ...r }) => ({ ...r, ...authorFields(authorName, agent) }));
}

/** What the app shell needs to know about the actor's relation to event requests. */
export interface RequestRights {
  isEventManager: boolean;
  isEventDeveloper: boolean;
  /** Whether the Requests section is shown: admins, event managers, event developers and requesters. */
  showRequests: boolean;
}

/** Returns the actor's event flags and whether the Requests link belongs in their sidebar. */
export async function requestRights(db: Db, actor: Actor): Promise<RequestRights> {
  const flags = await eventFlags(db, actor);
  let showRequests = flags.isAdmin || flags.isEventManager || flags.isEventDeveloper;
  if (!showRequests) {
    const [owned] = await db.select({ id: eventRequest.id }).from(eventRequest).where(eq(eventRequest.requesterId, actor.userId)).limit(1);
    showRequests = owned !== undefined;
  }
  return { isEventManager: flags.isEventManager, isEventDeveloper: flags.isEventDeveloper, showRequests };
}
