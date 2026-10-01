import { and, count, desc, eq, exists, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { allowedAccount, notification, project, projectMember, user, type NotificationKind } from "@/db/schema";
import type { Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { mentionsToPlain } from "@/lib/mentions";
import type { Actor } from "./actor";
import { isMember } from "./members";
export { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/notification-kinds";
import { readNotifyRules, wantsInbox, wantsPush } from "./notify-rules";

/** Input of {@link notify}. */
export interface NotifyInput {
  userId: string;
  projectId: string;
  kind: NotificationKind;
  entity: string;
  entityId: string;
  title: string;
  body?: string;
  /** An app-relative path starting with `/p/`. */
  href: string;
  actorName?: string | null;
  /** What created the notice, such as `cl:<change id>`; a user gets one notice per source. */
  sourceKey: string;
}

/** A notification as the inbox lists it. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string;
  actorName: string | null;
  projectSlug: string;
  projectName: string;
  createdAt: Date;
  readAt: Date | null;
}

const TITLE_LENGTH = 80;
const BODY_LENGTH = 140;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const MAX_UNREAD = 99;

/** Input of {@link listNotifications}. */
export const listNotificationsInput = z.object({
  /** The id of the last row of the previous page. */
  before: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
  /** Lists only unread rows. */
  unread: z.boolean().optional(),
});

/** Returns `text` as plain text (mention tokens as `@Name`) of at most `max` characters, ending with `…` when cut. */
function clip(text: string, max: number): string {
  const plain = mentionsToPlain(text);
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

/** Returns how a notice names who caused it: the person, or `<agent> for <name>` for agent writes. */
export function actorLabel(name: string | null | undefined, agent: string | null | undefined): string {
  const who = name?.trim() || "unknown";
  return agent ? `${agent} for ${who}` : who;
}

/** Returns whether a `system/column` change, whose value reads "<board> / <column>", moved the system into the column it is in now. */
export function inMovedColumn(newValue: string | null, columnName: string): boolean {
  return newValue?.endsWith(` / ${columnName}`) ?? false;
}

/** Returns whether the user may get notices of the project: it is not archived and they are an active member. Admins get nothing for membership alone. */
export async function canReceive(tx: Executor, userId: string, projectId: string): Promise<boolean> {
  const [row] = await tx.select({ archivedAt: project.archivedAt }).from(project).where(eq(project.id, projectId)).limit(1);
  if (!row || row.archivedAt) return false;
  return isMember(tx, projectId, userId);
}

/**
 * Creates a notice for one user, following their rules for the inbox and push.
 * Returns whether a row was created: nothing is created for a user who cannot receive it
 * or for a source key they already got.
 */
export async function notify(tx: Executor, input: NotifyInput): Promise<boolean> {
  if (!(await canReceive(tx, input.userId, input.projectId))) return false;
  const rules = await readNotifyRules(tx, input.userId);
  const inInbox = wantsInbox(rules, input.kind);
  const rows = await tx
    .insert(notification)
    .values({
      id: newId(),
      userId: input.userId,
      projectId: input.projectId,
      kind: input.kind,
      entity: input.entity,
      entityId: input.entityId,
      title: clip(input.title, TITLE_LENGTH),
      body: clip(input.body ?? "", BODY_LENGTH),
      href: input.href,
      actorName: input.actorName ?? null,
      sourceKey: input.sourceKey,
      inInbox,
      // A row kept only for push never counts as unread.
      readAt: inInbox ? null : new Date(),
      pushStatus: wantsPush(rules, input.kind) ? "pending" : "skipped",
    })
    .onConflictDoNothing({ target: [notification.userId, notification.sourceKey] })
    .returning({ id: notification.id });
  return rows.length > 0;
}

/**
 * Conditions for the actor's inbox rows in projects they can still see: the project is not
 * archived and they are still an active member. Callers join `project` onto `notification`.
 */
function visibleTo(db: Executor, actor: Actor): SQL[] {
  const membership = db
    .select({ one: sql`1` })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(and(eq(projectMember.projectId, notification.projectId), eq(projectMember.userId, notification.userId)));
  return [eq(notification.userId, actor.userId), eq(notification.inInbox, true), isNull(project.archivedAt), exists(membership)];
}

/** Lists the actor's inbox, newest first; `before` is the id of the last row of the previous page. */
export async function listNotifications(db: Executor, actor: Actor, raw: z.input<typeof listNotificationsInput>): Promise<NotificationItem[]> {
  const input = listNotificationsInput.parse(raw);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const conditions = visibleTo(db, actor);
  if (input.unread) conditions.push(isNull(notification.readAt));
  if (input.before) {
    // Compared in SQL, so the cursor keeps the database's microsecond timestamps.
    const cursor = alias(notification, "cursor");
    conditions.push(
      sql`(${notification.createdAt}, ${notification.id}) < (${db
        .select({ createdAt: cursor.createdAt, id: cursor.id })
        .from(cursor)
        .where(and(eq(cursor.id, input.before), eq(cursor.userId, actor.userId)))})`,
    );
  }
  return db
    .select({
      id: notification.id,
      kind: notification.kind,
      title: notification.title,
      body: notification.body,
      href: notification.href,
      actorName: notification.actorName,
      projectSlug: project.slug,
      projectName: project.name,
      createdAt: notification.createdAt,
      readAt: notification.readAt,
    })
    .from(notification)
    .innerJoin(project, eq(project.id, notification.projectId))
    .where(and(...conditions))
    .orderBy(desc(notification.createdAt), desc(notification.id))
    .limit(limit);
}

/** Counts the actor's unread inbox rows that {@link listNotifications} would show, capped at 100 so callers can tell "more than 99" apart. */
export async function unreadCount(db: Executor, actor: Actor): Promise<number> {
  const capped = db
    .select({ id: notification.id })
    .from(notification)
    .innerJoin(project, eq(project.id, notification.projectId))
    .where(and(...visibleTo(db, actor), isNull(notification.readAt)))
    .limit(MAX_UNREAD + 1)
    .as("capped");
  const [row] = await db.select({ n: count() }).from(capped);
  return row.n;
}

/** Marks the given notices read; ids of other users' rows are ignored. */
export async function markRead(db: Executor, actor: Actor, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, actor.userId), inArray(notification.id, ids), isNull(notification.readAt)));
}

/** Marks every unread notice of the actor read. */
export async function markAllRead(db: Executor, actor: Actor): Promise<void> {
  await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(and(eq(notification.userId, actor.userId), isNull(notification.readAt)));
}
