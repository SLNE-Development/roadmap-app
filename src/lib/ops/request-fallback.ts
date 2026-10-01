import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { eventFallback, eventUpload, type EventFallbackRow } from "@/db/schema";
import type { Db, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { requestAccess } from "./request-access";
import { lockRequest, logRequest } from "./requests";

export { fallbackReady, type FallbackReadiness } from "./request-setup";

const titleSchema = z.string().trim().min(1).max(120);

/** Input of {@link saveFallback}; every field is optional and `null` clears the optional ones. */
export const saveFallbackInput = z.object({
  title: titleSchema.optional(),
  whatWeDo: z.string().max(5000).optional(),
  whoDecides: z.string().max(500).optional(),
  /** A prepared player message; it is posted as one Discord message, so it fits its 2,000 characters. */
  playerMessage: z.string().max(2000).nullable().optional(),
  imageUploadId: z.string().min(1).max(64).nullable().optional(),
});

/** Input of {@link addFallback}. */
export const addFallbackInput = z.object({ title: titleSchema });

/** Lists the scenarios of a request, required ones first in their fixed order. */
export async function listFallbacks(db: Db, actor: Actor, requestId: string): Promise<EventFallbackRow[]> {
  await requestAccess(db, actor, requestId, "view");
  return db.select().from(eventFallback).where(eq(eventFallback.requestId, requestId)).orderBy(asc(eventFallback.sortOrder));
}

/** Loads a scenario of the request, locking the request first. */
async function lockedFallback(tx: Tx, requestId: string, fallbackId: string): Promise<EventFallbackRow> {
  await lockRequest(tx, requestId);
  const [row] = await tx.select().from(eventFallback).where(and(eq(eventFallback.id, fallbackId), eq(eventFallback.requestId, requestId))).limit(1);
  if (!row) throw new NotFoundError(`Unknown fallback scenario ${fallbackId}.`);
  return row;
}

/**
 * Changes a scenario. The image must be an upload of the same request, and the title of a required scenario stays.
 *
 * @throws InvalidError for a foreign image or a renamed required scenario
 * @throws ForbiddenError without edit access
 */
export async function saveFallback(db: Db, actor: Actor, requestId: string, fallbackId: string, raw: unknown): Promise<EventFallbackRow> {
  const input = saveFallbackInput.parse(raw);
  return db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const row = await lockedFallback(tx, requestId, fallbackId);
    if (input.title !== undefined && input.title !== row.title && row.required) throw new InvalidError("The title of a required scenario cannot be changed.");
    if (input.imageUploadId) {
      const [image] = await tx.select({ id: eventUpload.id }).from(eventUpload).where(and(eq(eventUpload.id, input.imageUploadId), eq(eventUpload.requestId, requestId))).limit(1);
      if (!image) throw new InvalidError("The image does not belong to this request.");
    }
    const patch = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.whatWeDo !== undefined ? { whatWeDo: input.whatWeDo } : {}),
      ...(input.whoDecides !== undefined ? { whoDecides: input.whoDecides } : {}),
      ...(input.playerMessage !== undefined ? { playerMessage: input.playerMessage?.trim() ? input.playerMessage : null } : {}),
      ...(input.imageUploadId !== undefined ? { imageUploadId: input.imageUploadId } : {}),
    };
    if (Object.keys(patch).length === 0) return row;
    const [updated] = await tx.update(eventFallback).set(patch).where(eq(eventFallback.id, fallbackId)).returning();
    await logRequest(tx, actor, { requestId, field: "fallback", newValue: updated.title });
    return updated;
  });
}

/** Adds a custom scenario, blank until filled; it never blocks the start of the event week. */
export async function addFallback(db: Db, actor: Actor, requestId: string, raw: unknown): Promise<EventFallbackRow> {
  const { title } = addFallbackInput.parse(raw);
  return db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    await lockRequest(tx, requestId);
    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${eventFallback.sortOrder}), -1) + 1` })
      .from(eventFallback)
      .where(eq(eventFallback.requestId, requestId));
    const id = newId();
    const [row] = await tx.insert(eventFallback).values({ id, requestId, key: `custom-${id}`, title, required: false, sortOrder: next }).returning();
    await logRequest(tx, actor, { requestId, field: "fallback", newValue: title });
    return row;
  });
}

/**
 * Removes a custom scenario.
 *
 * @throws ConflictError for a required scenario
 */
export async function removeFallback(db: Db, actor: Actor, requestId: string, fallbackId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await requestAccess(tx, actor, requestId, "edit");
    const row = await lockedFallback(tx, requestId, fallbackId);
    if (row.required) throw new ConflictError("A required scenario cannot be removed.");
    await tx.delete(eventFallback).where(eq(eventFallback.id, fallbackId));
    await logRequest(tx, actor, { requestId, field: "fallback", oldValue: row.title });
  });
}
