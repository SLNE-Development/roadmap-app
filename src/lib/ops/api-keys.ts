import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apikey } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

/** An API key as shown to its owner: never the key itself. */
export interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastRequest: Date | null;
}

/** Input for creating a key: a name and an optional lifetime in days. */
export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(32),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

/** Lists the actor's API keys, newest first. */
export async function listApiKeys(db: Executor, actor: Actor): Promise<ApiKeyRow[]> {
  return db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, actor.userId))
    .orderBy(desc(apikey.createdAt));
}

/**
 * Deletes one of the actor's API keys; it stops working immediately.
 *
 * @throws NotFoundError if the key does not exist or belongs to someone else
 */
export async function revokeApiKey(db: Executor, actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(apikey)
    .where(and(eq(apikey.id, id), eq(apikey.referenceId, actor.userId)))
    .returning({ id: apikey.id });
  if (deleted.length === 0) throw new NotFoundError(`Unknown API key ${id}.`);
}
