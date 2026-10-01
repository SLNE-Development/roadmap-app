import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { agentCall, agentRun, apikey } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError } from "./errors";

/** An API key as shown to its owner: never the key itself. */
export interface ApiKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  lastRequest: Date | null;
  usage: ApiKeyUsage;
  /** The id of the key this one replaced, if it was made by a rotation. */
  rotatedFrom: string | null;
  /** When a rotated-out key stops working, if it was rotated. */
  graceUntil: Date | null;
}

/** What an API key did recently: calls per UTC day (oldest first, today last) and 30-day totals. */
export interface ApiKeyUsage {
  last7Days: number[];
  total30Days: number;
  errors30Days: number;
}

const emptyUsage = (): ApiKeyUsage => ({ last7Days: Array<number>(7).fill(0), total30Days: 0, errors30Days: 0 });

/** How long a rotated-out key keeps working. */
const GRACE_MS = 24 * 3_600_000;

const DAY_MS = 86_400_000;

/** Input for creating a key: a name and an optional lifetime in days. */
export const createApiKeyInput = z.object({
  name: z.string().trim().min(1).max(32),
  expiresInDays: z.number().int().min(1).max(365).nullable(),
});

/** Reads a key's `metadata` column, which holds a JSON object (possibly stringified twice). */
function parseMetadata(raw: string | null): Record<string, unknown> {
  let value: unknown = raw;
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Lists the actor's API keys with their recent usage, newest first. */
export async function listApiKeys(db: Executor, actor: Actor, now: Date = new Date()): Promise<ApiKeyRow[]> {
  const keys = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
      metadata: apikey.metadata,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, actor.userId))
    .orderBy(desc(apikey.createdAt));
  if (keys.length === 0) return [];

  const today = Math.floor(now.getTime() / DAY_MS);
  const calls = await db
    .select({ keyId: agentRun.apiKeyId, at: agentCall.at, ok: agentCall.ok })
    .from(agentCall)
    .innerJoin(agentRun, eq(agentRun.id, agentCall.runId))
    .where(
      and(
        inArray(
          agentRun.apiKeyId,
          keys.map((k) => k.id),
        ),
        gte(agentCall.at, new Date((today - 29) * DAY_MS)),
      ),
    );
  const usage = new Map<string, ApiKeyUsage>();
  for (const c of calls) {
    const age = today - Math.floor(c.at.getTime() / DAY_MS);
    if (age < 0 || age > 29) continue;
    const u = usage.get(c.keyId) ?? emptyUsage();
    usage.set(c.keyId, u);
    u.total30Days += 1;
    if (!c.ok) u.errors30Days += 1;
    if (age < 7) u.last7Days[6 - age] += 1;
  }

  return keys.map(({ metadata, ...k }) => {
    const meta = parseMetadata(metadata);
    const grace = typeof meta.graceUntil === "string" ? new Date(meta.graceUntil) : null;
    return {
      ...k,
      usage: usage.get(k.id) ?? emptyUsage(),
      rotatedFrom: typeof meta.rotatedFrom === "string" ? meta.rotatedFrom : null,
      graceUntil: grace && !Number.isNaN(grace.getTime()) ? grace : null,
    };
  });
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

/**
 * Replaces one of the actor's API keys: creates a key with the same name and lifetime, and lets the old one
 * work for 24 hours more (or until its own expiry if that is sooner). Both keys record the link in `metadata`.
 *
 * @param create makes the new key and returns it with its id; `expiresIn` is in seconds, null for no expiry
 * @throws NotFoundError if the key does not exist or belongs to someone else
 * @throws ConflictError if the key is already in its grace period after a rotation
 */
export async function rotateApiKey(
  db: Executor,
  actor: Actor,
  id: string,
  create: (body: { name: string | undefined; expiresIn: number | null; userId: string }) => Promise<{ key: string; id: string }>,
  now: Date = new Date(),
): Promise<{ key: string }> {
  const [old] = await db
    .select({ name: apikey.name, createdAt: apikey.createdAt, expiresAt: apikey.expiresAt, metadata: apikey.metadata })
    .from(apikey)
    .where(and(eq(apikey.id, id), eq(apikey.referenceId, actor.userId)));
  if (!old) throw new NotFoundError(`Unknown API key ${id}.`);
  const { graceUntil: rotatedUntil } = parseMetadata(old.metadata);
  if (typeof rotatedUntil === "string" && new Date(rotatedUntil) > now) throw new ConflictError("This key was already rotated.");

  const expiresIn = old.expiresAt ? Math.round((old.expiresAt.getTime() - old.createdAt.getTime()) / 1000) : null;
  const created = await create({ name: old.name ?? undefined, expiresIn, userId: actor.userId });

  const graceUntil = new Date(Math.min(now.getTime() + GRACE_MS, old.expiresAt?.getTime() ?? Infinity));
  const oldMeta = { ...parseMetadata(old.metadata), rotatedTo: created.id, graceUntil: graceUntil.toISOString() };
  await db.transaction(async (tx) => {
    await tx.update(apikey).set({ expiresAt: graceUntil, metadata: JSON.stringify(oldMeta) }).where(eq(apikey.id, id));
    await tx
      .update(apikey)
      .set({ metadata: JSON.stringify({ rotatedFrom: id }) })
      .where(eq(apikey.id, created.id));
  });
  return { key: created.key };
}
