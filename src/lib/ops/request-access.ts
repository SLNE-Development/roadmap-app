import { and, eq, exists, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { allowedAccount, eventRequest, projectMember, user, type EventRequestRow, type ProjectRole } from "@/db/schema";
import type { Executor } from "@/db/types";
import { isOpen } from "@/lib/event-status";
import type { Actor } from "./actor";
import { ForbiddenError, NotFoundError } from "./errors";

/** The event-related flags of an actor; they are independent of each other and of project membership. */
export interface EventFlags {
  isAdmin: boolean;
  isEventManager: boolean;
  isEventDeveloper: boolean;
}

/** How an actor relates to a request, strongest first: event manager, admin who is not the requester (both `manager`), requester, event developer, linked-project member; `staff` is reserved for the event-day view. */
export type RequestRole = "requester" | "manager" | "developer" | "project" | "staff";

/** A request the actor may view, with their relation to it and whether they may edit it. */
export interface RequestAccess {
  request: EventRequestRow;
  role: RequestRole;
  flags: EventFlags;
  canEdit: boolean;
}

/** What an operation needs on a request. */
export type RequestNeed = "view" | "edit" | "manage" | "develop";

/** Reads the actor's event flags: the admin flag from the actor, the two event flags from `user`. */
export async function eventFlags(db: Executor, actor: Actor): Promise<EventFlags> {
  const [row] = await db
    .select({ isEventManager: user.isEventManager, isEventDeveloper: user.isEventDeveloper })
    .from(user)
    .where(eq(user.id, actor.userId))
    .limit(1);
  return { isAdmin: actor.isAdmin, isEventManager: row?.isEventManager ?? false, isEventDeveloper: row?.isEventDeveloper ?? false };
}

/** Returns whether the flags allow accepting requests: admins and event developers. */
export function canAcceptRequests(flags: EventFlags): boolean {
  return flags.isAdmin || flags.isEventDeveloper;
}

/** Throws unless the flags grant event manager rights (event managers and admins). */
export function requireEventManager(flags: EventFlags): void {
  if (!flags.isAdmin && !flags.isEventManager) throw new ForbiddenError("This needs the event manager role.");
}

/** Throws unless the flags grant event developer rights (event developers and admins). */
export function requireEventDeveloper(flags: EventFlags): void {
  if (!canAcceptRequests(flags)) throw new ForbiddenError("This needs the event developer role.");
}

/** Project roles that count as editor or higher. */
const EDITING: ProjectRole[] = ["editor", "owner"];

/**
 * The view rule as a SQL condition: whether the user `userId` (a column or an id) may view the request `requestId`.
 * It is the one place the rule lives; {@link canViewRequest} and the inbox query both use it. The user must still
 * be a provisioned account.
 *
 * View: the requester, event managers and admins; event developers and members of the linked project (any role)
 * only once the request is no longer a draft.
 */
export function requestViewableBy(db: Executor, userId: SQLWrapper | string, requestId: SQLWrapper | string): SQL {
  const viewer = alias(user, "view_user");
  const target = alias(eventRequest, "view_request");
  const member = db
    .select({ one: sql`1` })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, target.projectId), eq(projectMember.userId, viewer.id)));
  const allowed = db.select({ one: sql`1` }).from(allowedAccount).where(eq(allowedAccount.discordId, viewer.discordId));
  const visible = db
    .select({ one: sql`1` })
    .from(target)
    .innerJoin(viewer, eq(viewer.id, sql`${userId}`))
    .where(
      and(
        eq(target.id, sql`${requestId}`),
        exists(allowed),
        or(
          eq(viewer.isAdmin, true),
          eq(viewer.isEventManager, true),
          eq(target.requesterId, viewer.id),
          and(sql`${target.status} <> 'draft'`, or(eq(viewer.isEventDeveloper, true), exists(member))),
        ),
      ),
    );
  return exists(visible);
}

/** Returns whether the user may view the request, by the rule of {@link requestViewableBy}; false for an unknown request or user. */
export async function canViewRequest(db: Executor, userId: string, requestId: string): Promise<boolean> {
  const rows = await db
    .select({ id: eventRequest.id })
    .from(eventRequest)
    .where(and(eq(eventRequest.id, requestId), requestViewableBy(db, userId, requestId)))
    .limit(1);
  return rows.length > 0;
}

/**
 * Returns the request if the actor may act on it with `need`.
 *
 * View: the requester, event managers and admins; event developers and members
 * of the linked project (any role) only once it is no longer a draft.
 * Edit: the requester while it is open, event managers and admins always.
 * Manage: event managers and admins.
 * Develop: event developers and admins, or an editor or owner of the linked project.
 * An archived linked project changes nothing.
 *
 * @throws NotFoundError if the request is unknown or the actor may not even view it
 * @throws ForbiddenError if the actor may view it but lacks `need`
 */
export async function requestAccess(db: Executor, actor: Actor, requestId: string, need: RequestNeed): Promise<RequestAccess> {
  const [request] = await db.select().from(eventRequest).where(eq(eventRequest.id, requestId)).limit(1);
  if (!request) throw new NotFoundError(`Unknown request ${requestId}.`);
  const flags = await eventFlags(db, actor);
  if (!(await canViewRequest(db, actor.userId, requestId))) throw new NotFoundError(`Unknown request ${requestId}.`);
  const staff = flags.isAdmin || flags.isEventManager;
  const requester = request.requesterId === actor.userId;
  let member: ProjectRole | null = null;
  if (request.projectId) {
    const [row] = await db
      .select({ role: projectMember.role })
      .from(projectMember)
      .where(and(eq(projectMember.projectId, request.projectId), eq(projectMember.userId, actor.userId)))
      .limit(1);
    member = row?.role ?? null;
  }

  const role: RequestRole = flags.isEventManager || (flags.isAdmin && !requester)
    ? "manager"
    : requester
        ? "requester"
        : flags.isEventDeveloper
          ? "developer"
          : "project";
  const canEdit = staff || (requester && isOpen(request.status));
  if (need === "edit" && !canEdit) throw new ForbiddenError("This needs the requester of an open request, or the event manager role.");
  if (need === "manage") requireEventManager(flags);
  if (need === "develop" && !canAcceptRequests(flags) && !(member !== null && EDITING.includes(member))) {
    throw new ForbiddenError("This needs the event developer role or an editor role in the linked project.");
  }
  return { request, role, flags, canEdit };
}
