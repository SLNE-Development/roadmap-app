import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { allowedAccount, eventChecklistItem, eventFallback, eventTodo, projectMember, user, type EventTodoRow } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { loadPostSettings } from "./event-settings";
import { canDevelop, eventDayAccess, requestAccess, type RequestAccess } from "./request-access";
import { lockRequest, logRequest } from "./requests";

export { ensurePrepTodos } from "./request-setup";

const titleSchema = z.string().trim().min(1).max(200);
const dateSchema = z.union([z.date(), z.string().datetime({ offset: true })]).transform((v) => new Date(v));

/** Input of {@link addTodo}. */
export const addTodoInput = z.object({ title: titleSchema, ownerUserId: z.string().min(1).max(64).nullable().optional(), dueAt: dateSchema });

/** Input of {@link updateTodo}; setting `dueAt` marks the date as set by hand. */
export const updateTodoInput = z.object({ title: titleSchema.optional(), ownerUserId: z.string().min(1).max(64).nullable().optional(), dueAt: dateSchema.optional() });

/** Input of {@link addChecklistItem}. */
export const addChecklistItemInput = z.object({ label: titleSchema });

/** Input of {@link setEventChecklist}. */
export const setEventChecklistInput = z.object({ items: z.array(z.object({ label: titleSchema })).max(30) });

/** Edit access, or develop access for the developers who build the event. */
async function editOrDevelop(tx: Executor, actor: Actor, requestId: string): Promise<RequestAccess> {
  try {
    return await requestAccess(tx, actor, requestId, "edit");
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
    return requestAccess(tx, actor, requestId, "develop");
  }
}

/** Whether the to-do is late: past its due date and not done. */
export const isLate = (todo: Pick<EventTodoRow, "dueAt" | "doneAt">, now: Date = new Date()): boolean => todo.doneAt === null && todo.dueAt.getTime() < now.getTime();

/** A to-do with its owner's name and the derived `late` flag. */
export interface TodoView extends EventTodoRow {
  ownerName: string | null;
  late: boolean;
}

/** Lists the to-dos of a request by due date. */
export async function listTodos(db: Db, actor: Actor, requestId: string): Promise<TodoView[]> {
  await requestAccess(db, actor, requestId, "view");
  const rows = await db
    .select({ todo: eventTodo, ownerName: user.name })
    .from(eventTodo)
    .leftJoin(user, eq(user.id, eventTodo.ownerUserId))
    .where(eq(eventTodo.requestId, requestId))
    .orderBy(asc(eventTodo.dueAt), asc(eventTodo.createdAt));
  const now = new Date();
  return rows.map((r) => ({ ...r.todo, ownerName: r.ownerName?.trim() || null, late: isLate(r.todo, now) }));
}

/** Who a to-do can be given to: the requester, the developer who accepted, the people already owning to-dos, the members of the linked project and the actor. */
export async function listOwnerChoices(db: Db, actor: Actor, requestId: string): Promise<{ id: string; name: string }[]> {
  const { request } = await requestAccess(db, actor, requestId, "view");
  const todos = await db.select({ id: eventTodo.ownerUserId }).from(eventTodo).where(eq(eventTodo.requestId, requestId));
  const members = request.projectId ? await db.select({ id: projectMember.userId }).from(projectMember).where(eq(projectMember.projectId, request.projectId)) : [];
  const ids = new Set([request.requesterId, request.acceptedBy, actor.userId, ...todos.map((t) => t.id), ...members.map((m) => m.id)].filter((id): id is string => !!id));
  const rows = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(inArray(user.id, [...ids]))
    .orderBy(asc(user.name));
  return rows.map((r) => ({ id: r.id, name: r.name?.trim() || "unknown" }));
}

/** Throws unless the user is a provisioned account. */
async function requireProvisioned(tx: Executor, userId: string): Promise<void> {
  const [found] = await tx
    .select({ id: user.id })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(user.id, userId))
    .limit(1);
  if (!found) throw new InvalidError("The owner must be a provisioned user.");
}

/** Adds a custom to-do. Edit or develop access. */
export async function addTodo(db: Db, actor: Actor, requestId: string, raw: unknown): Promise<EventTodoRow> {
  const input = addTodoInput.parse(raw);
  return db.transaction(async (tx) => {
    await editOrDevelop(tx, actor, requestId);
    await lockRequest(tx, requestId);
    if (input.ownerUserId) await requireProvisioned(tx, input.ownerUserId);
    const [row] = await tx
      .insert(eventTodo)
      .values({ id: newId(), requestId, title: input.title, ownerUserId: input.ownerUserId ?? null, dueAt: input.dueAt, dueManual: true })
      .returning();
    await logRequest(tx, actor, { requestId, field: "todo", newValue: row.title });
    return row;
  });
}

/** Loads a to-do and its request id. */
async function findTodo(tx: Executor, todoId: string): Promise<EventTodoRow> {
  const [row] = await tx.select().from(eventTodo).where(eq(eventTodo.id, todoId)).limit(1);
  if (!row) throw new NotFoundError(`Unknown to-do ${todoId}.`);
  return row;
}

/**
 * Changes a to-do. A new `dueAt` marks the date as set by hand, so a later change of the event date leaves it alone.
 *
 * @throws InvalidError when the owner is not a provisioned user
 */
export async function updateTodo(db: Db, actor: Actor, todoId: string, raw: unknown): Promise<EventTodoRow> {
  const input = updateTodoInput.parse(raw);
  return db.transaction(async (tx) => {
    const todo = await findTodo(tx, todoId);
    await editOrDevelop(tx, actor, todo.requestId);
    if (input.ownerUserId) await requireProvisioned(tx, input.ownerUserId);
    const patch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.ownerUserId !== undefined ? { ownerUserId: input.ownerUserId } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt, dueManual: true } : {}),
    };
    if (Object.keys(patch).length === 0) return todo;
    const [row] = await tx.update(eventTodo).set(patch).where(eq(eventTodo.id, todoId)).returning();
    await logRequest(tx, actor, { requestId: todo.requestId, field: "todo", newValue: row.title });
    return row;
  });
}

/** Ticks or unticks a to-do. Its owner, the requester, managers, developers and admins may. */
export async function setTodoDone(db: Db, actor: Actor, todoId: string, done: boolean): Promise<EventTodoRow> {
  return db.transaction(async (tx) => {
    const todo = await findTodo(tx, todoId);
    const view = await requestAccess(tx, actor, todo.requestId, "view");
    const allowed = todo.ownerUserId === actor.userId || view.role !== "project";
    if (!allowed) await editOrDevelop(tx, actor, todo.requestId);
    const [row] = await tx
      .update(eventTodo)
      .set(done ? { doneAt: new Date(), doneBy: actor.userId } : { doneAt: null, doneBy: null })
      .where(eq(eventTodo.id, todoId))
      .returning();
    await logRequest(tx, actor, { requestId: todo.requestId, field: "todo", oldValue: todo.title, newValue: done ? "done" : "reopened" });
    return row;
  });
}

/**
 * Removes a custom to-do.
 *
 * @throws ConflictError for a template to-do
 */
export async function removeTodo(db: Db, actor: Actor, todoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const todo = await findTodo(tx, todoId);
    await editOrDevelop(tx, actor, todo.requestId);
    if (todo.templateKey !== null) throw new ConflictError("A template to-do cannot be removed.");
    await tx.delete(eventTodo).where(eq(eventTodo.id, todoId));
    await logRequest(tx, actor, { requestId: todo.requestId, field: "todo", oldValue: todo.title });
  });
}

/** An item of the event-day checklist. */
export type ChecklistItemRow = typeof eventChecklistItem.$inferSelect;

/** Lists the checklist items of a request in order. */
export async function listChecklist(db: Db, actor: Actor, requestId: string): Promise<ChecklistItemRow[]> {
  await eventDayAccess(db, actor, requestId);
  return checklistOf(db, requestId);
}

const checklistOf = (db: Executor, requestId: string) =>
  db.select().from(eventChecklistItem).where(eq(eventChecklistItem.requestId, requestId)).orderBy(asc(eventChecklistItem.sortOrder));

/**
 * Ticks or unticks a checklist item. Edit or develop access, and only in the event week so nothing is ticked ahead.
 *
 * @throws ConflictError outside the event week
 */
export async function setChecklistItem(db: Db, actor: Actor, itemId: string, done: boolean): Promise<ChecklistItemRow> {
  return db.transaction(async (tx) => {
    const [item] = await tx.select().from(eventChecklistItem).where(eq(eventChecklistItem.id, itemId)).limit(1);
    if (!item) throw new NotFoundError(`Unknown checklist item ${itemId}.`);
    await editOrDevelop(tx, actor, item.requestId);
    const request = await lockRequest(tx, item.requestId);
    if (request.status !== "event_week") throw new ConflictError("The checklist can only be ticked in the event week.");
    const [row] = await tx
      .update(eventChecklistItem)
      .set(done ? { doneAt: new Date(), doneBy: actor.userId } : { doneAt: null, doneBy: null })
      .where(eq(eventChecklistItem.id, itemId))
      .returning();
    await logRequest(tx, actor, { requestId: item.requestId, field: "checklist", oldValue: item.label, newValue: done ? "done" : "reopened" });
    return row;
  });
}

/** Adds a custom checklist item. Edit or develop access. */
export async function addChecklistItem(db: Db, actor: Actor, requestId: string, raw: unknown): Promise<ChecklistItemRow> {
  const { label } = addChecklistItemInput.parse(raw);
  return db.transaction(async (tx) => {
    await editOrDevelop(tx, actor, requestId);
    await lockRequest(tx, requestId);
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${eventChecklistItem.sortOrder}), -1) + 1` })
      .from(eventChecklistItem)
      .where(eq(eventChecklistItem.requestId, requestId));
    const [row] = await tx.insert(eventChecklistItem).values({ id: newId(), requestId, key: null, label, sortOrder: next }).returning();
    await logRequest(tx, actor, { requestId, field: "checklist", newValue: label });
    return row;
  });
}

/**
 * Replaces the open items of the checklist with the given labels; ticked items stay in front.
 *
 * @throws ConflictError for a done, withdrawn or cancelled request
 */
export async function setEventChecklist(db: Db, actor: Actor, requestId: string, raw: unknown): Promise<ChecklistItemRow[]> {
  const { items } = setEventChecklistInput.parse(raw);
  return db.transaction(async (tx) => {
    await editOrDevelop(tx, actor, requestId);
    const request = await lockRequest(tx, requestId);
    if (request.status === "done" || request.status === "withdrawn" || request.status === "cancelled") throw new ConflictError(`A ${request.status} request has no checklist to change.`);
    await tx.delete(eventChecklistItem).where(and(eq(eventChecklistItem.requestId, requestId), isNull(eventChecklistItem.doneAt)));
    const [{ max }] = await tx
      .select({ max: sql<number>`coalesce(max(${eventChecklistItem.sortOrder}), -1)` })
      .from(eventChecklistItem)
      .where(eq(eventChecklistItem.requestId, requestId));
    if (items.length > 0) await tx.insert(eventChecklistItem).values(items.map((item, i) => ({ id: newId(), requestId, key: null, label: item.label, sortOrder: max + 1 + i })));
    await logRequest(tx, actor, { requestId, field: "checklist", newValue: `${items.length} items` });
    return checklistOf(tx, requestId);
  });
}

/**
 * Removes a custom checklist item.
 *
 * @throws ConflictError for a template item
 */
export async function removeChecklistItem(db: Db, actor: Actor, itemId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [item] = await tx.select().from(eventChecklistItem).where(eq(eventChecklistItem.id, itemId)).limit(1);
    if (!item) throw new NotFoundError(`Unknown checklist item ${itemId}.`);
    await editOrDevelop(tx, actor, item.requestId);
    if (item.key !== null) throw new ConflictError("A template checklist item cannot be removed.");
    await tx.delete(eventChecklistItem).where(eq(eventChecklistItem.id, itemId));
    await logRequest(tx, actor, { requestId: item.requestId, field: "checklist", oldValue: item.label });
  });
}

/** What the Event day tab shows: the event, the checklist and the fallback scenarios; nothing else. */
export interface EventDayView {
  request: { id: string; title: string; startsAt: Date | null; durationMinutes: number | null; where: string; status: string };
  checklist: { id: string; key: string | null; label: string; doneAt: Date | null; doneByName: string | null }[];
  fallbacks: { id: string; key: string | null; title: string; whatWeDo: string; whoDecides: string; playerMessage: string | null }[];
  /** The time zone of the event settings, for filling placeholders in player messages. */
  timeZone: string;
  /** The event docs link of the request and the rulebook link of the settings, for `{docs}` and `{rules}` in player messages. */
  eventDocsUrl: string | null;
  rulebookUrl: string | null;
  /** Whether the actor may tick the checklist (edit or develop rights). */
  canTick: boolean;
}

/**
 * The event-day view. Anyone who may view the request sees it; in the event week every provisioned user does, with the
 * `staff` role. It carries no brief, no answers and no settings.
 *
 * @throws NotFoundError when the actor may not see the request
 */
export async function eventDayView(db: Db, actor: Actor, requestId: string): Promise<EventDayView> {
  const { request, canEdit } = await eventDayAccess(db, actor, requestId);
  const [checklist, fallbacks, settings] = await Promise.all([
    db
      .select({ item: eventChecklistItem, doneByName: user.name })
      .from(eventChecklistItem)
      .leftJoin(user, eq(user.id, eventChecklistItem.doneBy))
      .where(eq(eventChecklistItem.requestId, requestId))
      .orderBy(asc(eventChecklistItem.sortOrder)),
    db.select().from(eventFallback).where(eq(eventFallback.requestId, requestId)).orderBy(asc(eventFallback.sortOrder)),
    loadPostSettings(db),
  ]);
  const canTick = request.status === "event_week" && (canEdit || (await canDevelop(db, actor, requestId)));
  return {
    request: { id: request.id, title: request.title, startsAt: request.startsAt, durationMinutes: request.durationMinutes, where: request.where, status: request.status },
    checklist: checklist.map(({ item: c, doneByName }) => ({ id: c.id, key: c.key, label: c.label, doneAt: c.doneAt, doneByName })),
    fallbacks: fallbacks.map((f) => ({ id: f.id, key: f.key, title: f.title, whatWeDo: f.whatWeDo, whoDecides: f.whoDecides, playerMessage: f.playerMessage })),
    timeZone: settings.timeZone,
    eventDocsUrl: request.eventDocsUrl,
    rulebookUrl: settings.rulebookUrl,
    canTick,
  };
}
