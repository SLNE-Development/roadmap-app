import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { agentCall, agentRun, apikey, authEvent, project, user, type AuthEventKind, type AuthEventRow } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Kv } from "@/lib/kv";
import type { Actor } from "./actor";
import { ForbiddenError } from "./errors";

/** An auth event to record; the database sets its id and time. */
export type AuthEventInput = Omit<AuthEventRow, "id" | "at">;

/** An auth event as listed in the audit view, with the user's name. */
export interface AuditEventRow extends AuthEventRow {
  userName: string | null;
}

/** A failed agent tool call with its run and user. */
export interface FailedCallRow {
  id: number;
  at: Date;
  tool: string;
  transport: string;
  status: number;
  error: string | null;
  project: string | null;
  systemSlug: string | null;
  target: string | null;
  runId: string;
  runTitle: string | null;
  apiKeyId: string;
  userId: string;
  userName: string;
}

/** One API key's recent use, for admins. */
export interface KeyUsageRow {
  id: string;
  name: string | null;
  start: string | null;
  ownerId: string;
  ownerName: string;
  lastUsedAt: Date | null;
  calls30Days: number;
  errors30Days: number;
  rateLimited30Days: number;
}

const DAY_MS = 86_400_000;

/** Throws unless the actor is an admin. */
function requireAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can view the audit log.");
}

/** Records an auth event. Telemetry: never throws (failures are logged) and never written to `change_log`. */
export async function recordAuthEvent(db: Executor, event: AuthEventInput): Promise<void> {
  try {
    await db.insert(authEvent).values(event);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Records an auth event unless one with the same throttle key was recorded within `seconds`.
 * When the store fails, nothing is recorded, so a flood of events cannot reach the database unthrottled.
 * Never throws.
 */
export async function recordThrottled(db: Executor, kv: Kv, event: AuthEventInput, throttleKey: string, seconds: number): Promise<void> {
  try {
    if (await kv.get(throttleKey)) return;
    await kv.set(throttleKey, "1", seconds);
  } catch (error) {
    console.error(error);
    return;
  }
  await recordAuthEvent(db, event);
}

/**
 * Lists auth events, newest first, a page at a time: pass the previous page's `nextBefore` as `before`.
 * Admin only.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function listAuditEvents(
  db: Executor,
  actor: Actor,
  filter: { kind?: string; userId?: string; before?: number; limit?: number },
): Promise<{ events: AuditEventRow[]; nextBefore: number | null }> {
  requireAdmin(actor);
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const where: SQL[] = [];
  if (filter.kind) where.push(eq(authEvent.kind, filter.kind as AuthEventKind));
  if (filter.userId) where.push(eq(authEvent.userId, filter.userId));
  if (filter.before !== undefined) where.push(lt(authEvent.id, filter.before));
  const rows = await db
    .select({ event: authEvent, userName: user.name })
    .from(authEvent)
    .leftJoin(user, eq(user.id, authEvent.userId))
    .where(and(...where))
    .orderBy(desc(authEvent.id))
    .limit(limit + 1);
  const events = rows.slice(0, limit).map((r) => ({ ...r.event, userName: r.userName }));
  return { events, nextBefore: rows.length > limit ? events[events.length - 1].id : null };
}

/**
 * Lists failed agent tool calls of the last `days` days, newest first. Admin only.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function failedToolCalls(
  db: Executor,
  actor: Actor,
  { days = 7, limit = 100 }: { days?: number; limit?: number },
  now: Date = new Date(),
): Promise<FailedCallRow[]> {
  requireAdmin(actor);
  return db
    .select({
      id: agentCall.id,
      at: agentCall.at,
      tool: agentCall.tool,
      transport: agentCall.transport,
      status: agentCall.status,
      error: agentCall.error,
      project: project.slug,
      systemSlug: agentCall.systemSlug,
      target: agentCall.target,
      runId: agentRun.id,
      runTitle: agentRun.title,
      apiKeyId: agentRun.apiKeyId,
      userId: user.id,
      userName: user.name,
    })
    .from(agentCall)
    .innerJoin(agentRun, eq(agentRun.id, agentCall.runId))
    .innerJoin(user, eq(user.id, agentRun.userId))
    .leftJoin(project, eq(project.id, agentCall.projectId))
    .where(and(eq(agentCall.ok, false), gte(agentCall.at, new Date(now.getTime() - days * DAY_MS))))
    .orderBy(desc(agentCall.at), desc(agentCall.id))
    .limit(limit);
}

/**
 * Lists every API key with its owner and its use over the last 30 days, most recently used first. Admin only.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function keyUsageOverview(db: Executor, actor: Actor, now: Date = new Date()): Promise<KeyUsageRow[]> {
  requireAdmin(actor);
  const keys = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      ownerId: user.id,
      ownerName: user.name,
      lastUsedAt: apikey.lastRequest,
    })
    .from(apikey)
    .innerJoin(user, eq(user.id, apikey.referenceId))
    .orderBy(sql`${apikey.lastRequest} desc nulls last`, desc(apikey.createdAt));
  if (keys.length === 0) return [];

  const since = new Date(now.getTime() - 30 * DAY_MS);
  const ids = keys.map((k) => k.id);
  const [calls, limited] = await Promise.all([
    db
      .select({
        keyId: agentRun.apiKeyId,
        calls: count(),
        errors: sql<number>`count(*) filter (where not ${agentCall.ok})`.mapWith(Number),
      })
      .from(agentCall)
      .innerJoin(agentRun, eq(agentRun.id, agentCall.runId))
      .where(and(inArray(agentRun.apiKeyId, ids), gte(agentCall.at, since)))
      .groupBy(agentRun.apiKeyId),
    db
      .select({ keyId: authEvent.apiKeyId, n: count() })
      .from(authEvent)
      .where(and(eq(authEvent.kind, "key-rate-limited"), inArray(authEvent.apiKeyId, ids), gte(authEvent.at, since)))
      .groupBy(authEvent.apiKeyId),
  ]);
  const callsOf = new Map(calls.map((c) => [c.keyId, c]));
  const limitedOf = new Map(limited.map((l) => [l.keyId, l.n]));
  return keys.map((k) => ({
    ...k,
    calls30Days: callsOf.get(k.id)?.calls ?? 0,
    errors30Days: callsOf.get(k.id)?.errors ?? 0,
    rateLimited30Days: limitedOf.get(k.id) ?? 0,
  }));
}
