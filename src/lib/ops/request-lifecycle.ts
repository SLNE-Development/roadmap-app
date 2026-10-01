import { eq } from "drizzle-orm";
import { z } from "zod";
import { eventRequest, eventUpload, project, type EventRequestRow } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { Embed } from "@/lib/discord-limits";
import { buildCancelledEmbed } from "@/lib/event-messages";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import type { Actor } from "./actor";
import { projectAccess, projectAccessById } from "./access";
import { archiveProject } from "./archive";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { botConfigured, loadPostSettings } from "./event-settings";
import { requestAccess } from "./request-access";
import { announcementInDiscord } from "./request-posts";
import { deleteProject } from "./projects";
import { canDeleteRequest, lockRequest, manageOrDevelop, moveTo } from "./requests";
import { removeUploadFiles } from "./uploads";
import { uploadsDir } from "@/lib/uploads";

/** What cancelling would post: `willPost` with its embed (`{note}` left as the literal `{note}` for the client to fill), or why nothing is posted. */
export interface CancelPreview {
  willPost: boolean;
  reason: "posted" | "not-posted" | "no-webhook";
  embed: Embed | null;
}

/**
 * Whether cancelling the request would post a cancelled message to Discord, and how it would look. Sends nothing.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without manage or develop access
 */
export async function cancelPreview(db: Db, actor: Actor, requestId: string): Promise<CancelPreview> {
  const { request } = await manageOrDevelop(db, actor, requestId);
  if (!(await announcementInDiscord(db, requestId))) return { willPost: false, reason: "not-posted", embed: null };
  const settings = await loadPostSettings(db);
  if (!settings.hooks.public) return { willPost: false, reason: "no-webhook", embed: null };
  return { willPost: true, reason: "posted", embed: buildCancelledEmbed(request, settings, null) };
}

/**
 * Reopens a request: `cancelled` becomes `accepted` (manage or develop access) and `withdrawn` becomes `draft` (edit access, or
 * the requester of the request). Clears the cancel note and logs the status change. No message is posted. When the request is
 * accepted again, its announcement is in Discord and the bot is configured, `events.discord-event` is queued to create the event.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without the access above
 * @throws ConflictError for a status that cannot be reopened
 */
export async function reopenRequest(db: Db, actor: Actor, requestId: string, queue?: JobQueue): Promise<EventRequestRow> {
  const reopened = await db.transaction(async (tx) => {
    const { request: seen } = await requestAccess(tx, actor, requestId, "view");
    if (seen.status !== "cancelled" && seen.status !== "withdrawn") throw new ConflictError(`A ${seen.status} request cannot be reopened.`);
    await lockRequest(tx, requestId);
    if (seen.status === "cancelled") {
      const { request } = await manageOrDevelop(tx, actor, requestId);
      return moveTo(tx, actor, request, "accepted", { cancelNote: null });
    }
    const { request, canEdit, role } = await requestAccess(tx, actor, requestId, "view");
    if (!canEdit && role !== "requester") throw new ForbiddenError("Only the requester or an event manager can reopen a withdrawn request.");
    return moveTo(tx, actor, request, "draft", { cancelNote: null });
  });
  if (reopened.status === "accepted" && queue && (await botConfigured(db)) && (await announcementInDiscord(db, requestId))) {
    try {
      await addWithTimeout(queue, "events.discord-event", { requestId, action: "create" }, { jobId: `event-dev-${requestId}-create-${reopened.updatedAt.getTime()}`, attempts: 3, backoffMs: 10_000 });
    } catch (error) {
      console.error(`could not queue the Discord event create of request ${requestId}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
  return reopened;
}

/** Input of {@link deleteRequest}: what happens to the project that was created from the event. */
export const deleteRequestInput = z.object({ project: z.enum(["keep", "archive", "delete"]).default("keep") });

/** What the delete dialog offers: whether the actor may delete, and the project that was created from the event with their rights on it. */
export interface DeleteChoices {
  allowed: boolean;
  reason: string | null;
  project: { slug: string; name: string; created: boolean; canArchive: boolean; canDelete: boolean; archived: boolean } | null;
}

/** The refusal of a delete as text, or null when the actor may delete a request in `status`. */
function deleteRefusal(request: EventRequestRow, staff: boolean, requester: boolean): string | null {
  if (!["draft", "submitted", "withdrawn", "cancelled"].includes(request.status)) return "Only drafts, submitted, withdrawn and cancelled events can be deleted.";
  if (!canDeleteRequest(request.status, staff, requester)) return "Only the requester of a draft or withdrawn request, or an event manager, can delete it.";
  return null;
}

/** Whether the actor is owner of the project (or admin); false for a project they cannot see or write. */
async function ownsProject(tx: Executor, actor: Actor, slug: string): Promise<boolean> {
  try {
    await projectAccess(tx, actor, slug, "owner", { allowArchived: true });
    return true;
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof NotFoundError) return false;
    throw error;
  }
}

/**
 * What the delete dialog shows: whether the actor may delete the request and, when a project exists for it, its name and
 * whether the actor may archive or delete it (owner or admin) and whether it was created from the event.
 *
 * @throws NotFoundError for a request the actor cannot see
 */
export async function deleteChoices(db: Db, actor: Actor, requestId: string): Promise<DeleteChoices> {
  const { request, flags } = await requestAccess(db, actor, requestId, "view");
  const reason = deleteRefusal(request, flags.isAdmin || flags.isEventManager, request.requesterId === actor.userId);
  const [linked] = request.projectId ? await db.select({ slug: project.slug, name: project.name, archivedAt: project.archivedAt }).from(project).where(eq(project.id, request.projectId)) : [];
  if (!linked) return { allowed: reason === null, reason, project: null };
  const owner = await ownsProject(db, actor, linked.slug);
  return { allowed: reason === null, reason, project: { slug: linked.slug, name: linked.name, created: request.projectCreated, canArchive: owner, canDelete: owner, archived: linked.archivedAt != null } };
}

/**
 * Deletes a draft, submitted, withdrawn or cancelled request with its uploads, history and posts (the messages already in
 * Discord stay). Managers and admins may; the requester may delete their own draft or withdrawn request. A project that was
 * created from the event is kept, archived or deleted as `project` says, which needs owner rights on it and is checked before
 * anything is deleted. After the commit it archives or deletes the project, removes the upload files and queues
 * `events.discord-event` to delete a remaining Discord event by its ids.
 *
 * @throws NotFoundError for a request the actor cannot see, ForbiddenError without the rights above
 * @throws ConflictError for a status that cannot be deleted
 * @throws InvalidError when the project was not created from the event
 */
export async function deleteRequest(db: Db, actor: Actor, requestId: string, raw: unknown, queue?: JobQueue, dir: string = uploadsDir()): Promise<void> {
  const { project: choice } = deleteRequestInput.parse(raw);
  const done = await db.transaction(async (tx) => {
    await lockRequest(tx, requestId);
    const { request, flags } = await requestAccess(tx, actor, requestId, "view");
    const staff = flags.isAdmin || flags.isEventManager;
    if (!["draft", "submitted", "withdrawn", "cancelled"].includes(request.status)) throw new ConflictError("Only drafts, submitted, withdrawn and cancelled events can be deleted.");
    if (!canDeleteRequest(request.status, staff, request.requesterId === actor.userId)) throw new ForbiddenError("Only the requester of a draft or withdrawn request, or an event manager, can delete it.");
    let slug: string | null = null;
    if (choice !== "keep") {
      if (!request.projectCreated || !request.projectId) throw new InvalidError("Only a project created from this event can be archived or deleted here.");
      const { project: target } = await projectAccessById(tx, actor, request.projectId, "owner", { allowArchived: true });
      slug = target.slug;
    }
    const keys = (await tx.select({ key: eventUpload.storageKey }).from(eventUpload).where(eq(eventUpload.requestId, requestId))).map((r) => r.key);
    const orphan = request.discordEventId && (await botConfigured(tx)) ? { guildId: (await loadPostSettings(tx)).guildId, eventId: request.discordEventId } : null;
    await tx.delete(eventRequest).where(eq(eventRequest.id, requestId));
    return { slug, keys, orphan };
  });
  if (done.slug) {
    if (choice === "archive") await archiveProject(db, actor, done.slug);
    else await deleteProject(db, actor, done.slug);
  }
  await removeUploadFiles(done.keys, dir);
  if (done.orphan?.guildId && queue) {
    try {
      await addWithTimeout(queue, "events.discord-event", { requestId, action: "delete-orphan", guildId: done.orphan.guildId, eventId: done.orphan.eventId }, { jobId: `event-dev-${requestId}-delete-orphan`, attempts: 3, backoffMs: 10_000 });
    } catch (error) {
      console.error(`could not queue the Discord event delete of request ${requestId}: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}
