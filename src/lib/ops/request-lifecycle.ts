import type { EventRequestRow } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Embed } from "@/lib/discord-limits";
import { buildCancelledEmbed } from "@/lib/event-messages";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError } from "./errors";
import { botConfigured, loadPostSettings } from "./event-settings";
import { requestAccess } from "./request-access";
import { announcementInDiscord } from "./request-posts";
import { lockRequest, manageOrDevelop, moveTo } from "./requests";

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
