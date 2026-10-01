import { and, eq, inArray, or } from "drizzle-orm";
import { allowedAccount, projectMember, user, type EventRequestRow } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { NotificationKind } from "@/lib/notification-kinds";
import type { NotificationText } from "@/lib/notification-text";
import type { Actor } from "./actor";
import { actorLabel, notify } from "./notifications";

/** The notification kinds about event requests. */
export type RequestNotificationKind = Extract<NotificationKind, `request.${string}`>;

/** Input of {@link notifyRequest}. */
export interface RequestNotifyInput {
  requestId: string;
  kind: RequestNotificationKind;
  userIds: string[];
  /** The title as written, or a message rendered in each recipient's language. */
  title: string | NotificationText;
  body?: string;
  /** What created the notice, such as `req:<id>:submitted:1`; each user gets one notice per source. */
  sourceKey: string;
  /** The request page tab the notice opens, such as `questions`. */
  tab?: string;
  /** Who caused it; null for reminders. The actor never gets their own notice. */
  actor: Actor | null;
}

/** Returns the ids of provisioned accounts matching `condition`. */
async function provisioned(tx: Executor, condition: ReturnType<typeof or>): Promise<string[]> {
  const rows = await tx
    .select({ id: user.id })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(condition);
  return rows.map((r) => r.id);
}

/** Returns the ids of the people who accept requests: admins and event developers with an allowed account. */
export function developerIds(tx: Executor): Promise<string[]> {
  return provisioned(tx, or(eq(user.isAdmin, true), eq(user.isEventDeveloper, true)));
}

/** Returns the ids of the people who manage requests: admins and event managers with an allowed account. */
export function managerIds(tx: Executor): Promise<string[]> {
  return provisioned(tx, or(eq(user.isAdmin, true), eq(user.isEventManager, true)));
}

/** Returns the requester of a request, or null once their account is gone. */
export function requesterIdOf(request: Pick<EventRequestRow, "requesterId">): string | null {
  return request.requesterId;
}

/** Returns the ids of the people a changed brief concerns once it is accepted: editors and owners of the linked project and the accepting developer. */
export async function briefAudienceIds(tx: Executor, request: EventRequestRow): Promise<string[]> {
  const ids = new Set<string>();
  if (request.projectId) {
    const rows = await tx
      .select({ id: projectMember.userId })
      .from(projectMember)
      .where(and(eq(projectMember.projectId, request.projectId), inArray(projectMember.role, ["editor", "owner"])));
    for (const r of rows) ids.add(r.id);
  }
  if (request.acceptedBy) ids.add(request.acceptedBy);
  return [...ids];
}

/**
 * Notifies `userIds` about a request through `notify`, skipping the acting user (reminders have no actor, so
 * they reach everyone). The notice opens `/requests/<id>`, on the tab `tab` when given.
 *
 * @returns how many notices were created
 */
export async function notifyRequest(tx: Executor, input: RequestNotifyInput): Promise<number> {
  const href = `/requests/${input.requestId}${input.tab ? `?tab=${input.tab}` : ""}`;
  let created = 0;
  for (const userId of new Set(input.userIds)) {
    if (input.actor && userId === input.actor.userId) continue;
    const ok = await notify(tx, {
      userId,
      requestId: input.requestId,
      kind: input.kind,
      entity: "request",
      entityId: input.requestId,
      title: input.title,
      body: input.body,
      href,
      actorName: input.actor ? actorLabel(input.actor.name, input.actor.agent) : null,
      sourceKey: input.sourceKey,
    });
    if (ok) created++;
  }
  return created;
}
