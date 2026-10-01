import { and, asc, eq, isNull } from "drizzle-orm";
import { eventChecklistItem, eventFallback, eventTodo, type EventRequestRow } from "@/db/schema";
import type { Executor } from "@/db/types";
import { CHECKLIST_TEMPLATE, dueFor, PREP_TEMPLATE, REQUIRED_FALLBACKS } from "@/lib/event-prep-template";
import { newId } from "@/lib/id";
import { eventTimeZone } from "./event-settings";

/**
 * Gives a new request its three empty required fallback scenarios and its four checklist items. Request creation and the
 * test fixtures both call this, so fixtures match real requests.
 */
export async function seedRequestDefaults(db: Executor, requestId: string): Promise<void> {
  await db.insert(eventFallback).values(
    REQUIRED_FALLBACKS.map((f, i) => ({ id: newId(), requestId, key: f.key, title: f.title, required: true, sortOrder: i })),
  );
  await db.insert(eventChecklistItem).values(CHECKLIST_TEMPLATE.map((c, i) => ({ id: newId(), requestId, key: c.key, label: c.label, sortOrder: i })));
}

/**
 * Creates the six template to-dos of an accepted request; the requester owns the announcements and the accepting
 * developer the build steps. Does nothing while the request has no start time.
 */
export async function ensurePrepTodos(db: Executor, request: EventRequestRow, developerUserId: string): Promise<void> {
  if (!request.startsAt) return;
  const zone = await eventTimeZone(db);
  const existing = await db.select({ key: eventTodo.templateKey }).from(eventTodo).where(eq(eventTodo.requestId, request.id));
  const have = new Set(existing.map((t) => t.key));
  const rows = PREP_TEMPLATE.filter((s) => !have.has(s.key)).map((s) => ({
    id: newId(),
    requestId: request.id,
    templateKey: s.key,
    title: s.title,
    ownerUserId: s.owner === "requester" ? request.requesterId : developerUserId,
    dueAt: dueFor(request.startsAt!, s.offsetDays, zone),
  }));
  if (rows.length > 0) await db.insert(eventTodo).values(rows);
}

/** Moves every template to-do that is neither done nor dated by hand to the template date for the request's current start. */
export async function redateTodos(db: Executor, request: EventRequestRow): Promise<void> {
  if (!request.startsAt) return;
  const zone = await eventTimeZone(db);
  for (const step of PREP_TEMPLATE) {
    await db
      .update(eventTodo)
      .set({ dueAt: dueFor(request.startsAt, step.offsetDays, zone) })
      .where(and(eq(eventTodo.requestId, request.id), eq(eventTodo.templateKey, step.key), isNull(eventTodo.doneAt), eq(eventTodo.dueManual, false)));
  }
}

/** The result of {@link fallbackReady}. */
export interface FallbackReadiness {
  ready: boolean;
  missing: { key: string; title: string; missing: ("whatWeDo" | "whoDecides")[] }[];
}

/**
 * Checks the fallback plan: a required scenario is complete when `whatWeDo` and `whoDecides` are non-blank after
 * trimming. The player message and image stay optional, and a blank custom scenario never blocks.
 */
export async function fallbackReady(db: Executor, requestId: string): Promise<FallbackReadiness> {
  const rows = await db.select().from(eventFallback).where(and(eq(eventFallback.requestId, requestId), eq(eventFallback.required, true))).orderBy(asc(eventFallback.sortOrder));
  const missing = rows.flatMap((f) => {
    const fields: ("whatWeDo" | "whoDecides")[] = [];
    if (!f.whatWeDo.trim()) fields.push("whatWeDo");
    if (!f.whoDecides.trim()) fields.push("whoDecides");
    return fields.length > 0 ? [{ key: f.key, title: f.title, missing: fields }] : [];
  });
  return { ready: missing.length === 0, missing };
}
