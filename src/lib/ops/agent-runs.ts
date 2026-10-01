import { and, asc, count, desc, eq, exists, gt, gte, inArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { agentCall, agentRun, changeLog, project, user } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { selectHistory, type HistoryEntry } from "./activity";
import { NotFoundError } from "./errors";
import { findSystem } from "./lookup";

/** A key's calls join its latest run while that run's last call is less than this old. */
export const RUN_GAP_MS = 10 * 60_000;

/** Longest stored error message, in characters. */
const MAX_ERROR = 300;

/** Longest stored system slug or target, in characters. */
const MAX_LABEL = 100;

/** One tool call as the adapters report it; only its tool, project, system and target are stored, never the input. */
export interface CallRecord {
  apiKeyId: string;
  userId: string;
  agent: string | null;
  tool: string;
  transport: "mcp" | "rest";
  input: Record<string, unknown>;
  ok: boolean;
  status: number;
  error: string | null;
  durationMs: number;
  at: Date;
}

/** Passes a record to an optional recorder; a throwing recorder is logged and never breaks the call. */
export function notifyRecorder(recordCall: ((r: CallRecord) => void) | undefined, record: CallRecord): void {
  try {
    recordCall?.(record);
  } catch (error) {
    console.error(error);
  }
}

/** Batch tools, with the input array they take and the noun their target counts. */
const BATCHES: Record<string, [field: string, noun: string]> = {
  add_tasks: ["tasks", "tasks"],
  update_tasks: ["updates", "tasks"],
  answer_questions: ["answers", "questions"],
};

/** Tools acting on one task by `id`. */
const TASK_TOOLS = new Set(["update_task", "move_task", "set_task_checks"]);

/** Tools acting on one ADR by `number`. */
const ADR_TOOLS = new Set(["get_adr", "update_adr", "accept_adr", "supersede_adr"]);

/**
 * Returns a short label of what a call touched: `task #<id>`, `<n> tasks` for batches,
 * `ADR <number>`, `<kind> v<version>` for documents, otherwise the system slug or `null`.
 */
export function callTarget(tool: string, input: Record<string, unknown>): string | null {
  const batch = BATCHES[tool];
  if (batch && Array.isArray(input[batch[0]])) return `${(input[batch[0]] as unknown[]).length} ${batch[1]}`;
  if (TASK_TOOLS.has(tool) && input.id !== undefined) return `task #${String(input.id)}`;
  if (ADR_TOOLS.has(tool) && input.number !== undefined) return `ADR ${String(input.number)}`;
  if (tool === "get_document" && typeof input.kind === "string") {
    return input.version === undefined ? input.kind : `${input.kind} v${String(input.version)}`;
  }
  return typeof input.system === "string" ? input.system : null;
}

/** Serialises a key's run bookkeeping, so concurrent calls of one key land in one run. */
async function lockKey(tx: Tx, apiKeyId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${apiKeyId}))`);
}

/** Returns the id of the key's latest run if its last call is less than {@link RUN_GAP_MS} before `at`. */
async function currentRun(tx: Tx, apiKeyId: string, at: Date): Promise<string | null> {
  const [run] = await tx
    .select({ id: agentRun.id, lastCallAt: agentRun.lastCallAt })
    .from(agentRun)
    .where(eq(agentRun.apiKeyId, apiKeyId))
    .orderBy(desc(agentRun.lastCallAt))
    .limit(1);
  return run && at.getTime() - run.lastCallAt.getTime() < RUN_GAP_MS ? run.id : null;
}

/**
 * Stores one call in the key's current run, starting a run when the key has none
 * within {@link RUN_GAP_MS}. Telemetry: never written to `change_log`.
 */
export async function recordCall(db: Db, record: CallRecord): Promise<void> {
  const slug = typeof record.input.project === "string" ? record.input.project : null;
  const system = typeof record.input.system === "string" ? record.input.system.slice(0, MAX_LABEL) : null;
  await db.transaction(async (tx) => {
    await lockKey(tx, record.apiKeyId);
    let runId = await currentRun(tx, record.apiKeyId, record.at);
    if (!runId) {
      runId = newId();
      await tx.insert(agentRun).values({ id: runId, apiKeyId: record.apiKeyId, userId: record.userId, startedAt: record.at, lastCallAt: record.at });
    }
    const [found] = slug ? await tx.select({ id: project.id }).from(project).where(eq(project.slug, slug)).limit(1) : [];
    await tx.insert(agentCall).values({
      runId,
      at: record.at,
      tool: record.tool,
      transport: record.transport,
      agent: record.agent,
      projectId: found?.id ?? null,
      systemSlug: system,
      target: callTarget(record.tool, record.input)?.slice(0, MAX_LABEL) ?? null,
      ok: record.ok,
      status: record.status,
      error: record.error?.slice(0, MAX_ERROR) ?? null,
      durationMs: Math.round(record.durationMs),
    });
    await tx
      .update(agentRun)
      .set({
        callCount: sql`${agentRun.callCount} + 1`,
        errorCount: record.ok ? agentRun.errorCount : sql`${agentRun.errorCount} + 1`,
        lastCallAt: sql`greatest(${agentRun.lastCallAt}, ${record.at.toISOString()}::timestamptz)`,
      })
      .where(eq(agentRun.id, runId));
  });
}

/** Input of {@link startRun}: how the agent names its session. */
export const startRunInput = z.object({
  title: z.string().trim().max(120).optional(),
  repo: z.string().trim().max(200).optional(),
  branch: z.string().trim().max(200).optional(),
  clientSessionId: z.string().trim().min(1).max(100).optional(),
});

/** Returns the run with a client session id, refusing one that belongs to another user. */
async function sessionRun(tx: Tx, actor: Actor, clientSessionId: string): Promise<string | null> {
  const [run] = await tx.select({ id: agentRun.id, userId: agentRun.userId }).from(agentRun).where(eq(agentRun.clientSessionId, clientSessionId));
  if (run && run.userId !== actor.userId) throw new NotFoundError(`Unknown agent session ${clientSessionId}.`);
  return run?.id ?? null;
}

/**
 * Starts a run for the key that its next calls join, named by title, repo and branch.
 * A known `clientSessionId` returns that run with its names updated instead.
 *
 * @throws NotFoundError when the session id belongs to another user
 */
export async function startRun(db: Db, actor: Actor, apiKeyId: string, input: z.input<typeof startRunInput>): Promise<{ runId: string }> {
  const { title, repo, branch, clientSessionId } = startRunInput.parse(input);
  return db.transaction(async (tx) => {
    await lockKey(tx, apiKeyId);
    const existing = clientSessionId ? await sessionRun(tx, actor, clientSessionId) : null;
    const now = new Date();
    if (existing) {
      await tx
        .update(agentRun)
        .set({ title, repo, branch, lastCallAt: sql`greatest(${agentRun.lastCallAt}, ${now.toISOString()}::timestamptz)` })
        .where(eq(agentRun.id, existing));
      return { runId: existing };
    }
    const runId = newId();
    await tx.insert(agentRun).values({ id: runId, apiKeyId, userId: actor.userId, title, repo, branch, clientSessionId, startedAt: now, lastCallAt: now });
    return { runId };
  });
}

/** A token total: a non-negative integer up to 2^53 − 1. */
const tokens = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Input of {@link recordUsage}: a session's token totals so far. */
export const recordUsageInput = z.object({
  clientSessionId: z.string().trim().min(1).max(100),
  inputTokens: tokens,
  outputTokens: tokens,
  cacheReadTokens: tokens,
  cacheWriteTokens: tokens,
});

/**
 * Sets the token totals of the actor's run with this client session id, replacing
 * earlier totals. An unknown session gets a new run for the key.
 *
 * @throws NotFoundError when the session id belongs to another user
 */
export async function recordUsage(db: Db, actor: Actor, apiKeyId: string, input: z.input<typeof recordUsageInput>): Promise<void> {
  const { clientSessionId, ...totals } = recordUsageInput.parse(input);
  await db.transaction(async (tx) => {
    await lockKey(tx, apiKeyId);
    const existing = await sessionRun(tx, actor, clientSessionId);
    if (existing) {
      await tx.update(agentRun).set(totals).where(and(eq(agentRun.id, existing), eq(agentRun.userId, actor.userId)));
      return;
    }
    await tx.insert(agentRun).values({ id: newId(), apiKeyId, userId: actor.userId, clientSessionId, ...totals });
  });
}

/** A run is live while its last call is less than this old. */
export const LIVE_MS = 2 * 60_000;

/** A run is recent while its last call is less than this old. */
const RECENT_MS = 24 * 3_600_000;

/** A failed run is listed while its last call is less than this old. */
const FAILED_MS = 7 * 86_400_000;

/** Changes up to this long after a run's last call still count as the run's. */
const CHANGE_GRACE_MS = 5000;

/** One run as the agents page lists it; call and error counts are those in this project, tokens the run's total. */
export interface RunSummary {
  id: string;
  title: string | null;
  repo: string | null;
  branch: string | null;
  userId: string;
  userName: string;
  startedAt: Date;
  lastCallAt: Date;
  callCount: number;
  errorCount: number;
  live: boolean;
  /** The session's token totals, or `null` when the client never reported usage. */
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number } | null;
}

/** One call of a run in the project. */
export interface CallRow {
  id: number;
  at: Date;
  tool: string;
  transport: "mcp" | "rest";
  systemSlug: string | null;
  target: string | null;
  ok: boolean;
  status: number;
  error: string | null;
  durationMs: number;
}

/** Filters of {@link listProjectRuns}. */
export interface RunFilter {
  state?: "live" | "recent" | "failed";
  limit?: number;
}

/** A condition that the run has a call in `projectId`, a failed one when `failedOnly`. */
function callsIn(db: Executor, projectId: string, failedOnly = false): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(agentCall)
      .where(and(eq(agentCall.runId, agentRun.id), eq(agentCall.projectId, projectId), failedOnly ? eq(agentCall.ok, false) : undefined)),
  );
}

/** Selects runs of the project matching `conditions`, newest call first. */
async function selectRuns(db: Executor, projectId: string, conditions: SQL[], limit: number, now: Date): Promise<RunSummary[]> {
  const rows = await db
    .select({
      run: agentRun,
      userName: user.name,
      calls: sql<number>`(select count(*) from ${agentCall} where ${agentCall.runId} = ${agentRun.id} and ${agentCall.projectId} = ${projectId})`.mapWith(Number),
      errors: sql<number>`(select count(*) from ${agentCall} where ${agentCall.runId} = ${agentRun.id} and ${agentCall.projectId} = ${projectId} and not ${agentCall.ok})`.mapWith(Number),
    })
    .from(agentRun)
    .innerJoin(user, eq(user.id, agentRun.userId))
    .where(and(callsIn(db, projectId), ...conditions))
    .orderBy(desc(agentRun.lastCallAt))
    .limit(limit);
  return rows.map(({ run, userName, calls, errors }) => ({
    id: run.id,
    title: run.title,
    repo: run.repo,
    branch: run.branch,
    userId: run.userId,
    userName,
    startedAt: run.startedAt,
    lastCallAt: run.lastCallAt,
    callCount: calls,
    errorCount: errors,
    live: now.getTime() - run.lastCallAt.getTime() < LIVE_MS,
    tokens:
      run.inputTokens === null && run.outputTokens === null && run.cacheReadTokens === null && run.cacheWriteTokens === null
        ? null
        : { input: run.inputTokens ?? 0, output: run.outputTokens ?? 0, cacheRead: run.cacheReadTokens ?? 0, cacheWrite: run.cacheWriteTokens ?? 0 },
  }));
}

/**
 * Lists the runs with a call in the project, newest first: `live` (last call under
 * 2 minutes ago), `recent` (last 24 hours) or `failed` (errors within 7 days).
 *
 * @param now the reference time, injected by tests
 * @throws NotFoundError if the actor cannot see the project
 */
export async function listProjectRuns(db: Executor, actor: Actor, slug: string, filter: RunFilter = {}, now: Date = new Date()): Promise<RunSummary[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const within = (ms: number) => gte(agentRun.lastCallAt, new Date(now.getTime() - ms));
  const conditions: SQL[] = [];
  if (filter.state === "live") conditions.push(gt(agentRun.lastCallAt, new Date(now.getTime() - LIVE_MS)));
  if (filter.state === "recent") conditions.push(within(RECENT_MS));
  if (filter.state === "failed") conditions.push(callsIn(db, project.id, true), within(FAILED_MS));
  return selectRuns(db, project.id, conditions, filter.limit ?? 50, now);
}

/** Counts the project's live runs, for the sidebar. */
export async function liveRunCount(db: Executor, projectId: string, now: Date = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(agentRun)
    .where(and(callsIn(db, projectId), gt(agentRun.lastCallAt, new Date(now.getTime() - LIVE_MS))));
  return row.n;
}

/**
 * Returns a run with its calls in the project in time order and the agent changes
 * its user made in the project while it ran, oldest first ("What changed").
 *
 * @throws NotFoundError if the actor cannot see the project or the run has no call in it
 */
export async function getRun(
  db: Executor,
  actor: Actor,
  slug: string,
  runId: string,
): Promise<{ run: RunSummary; calls: CallRow[]; changes: HistoryEntry[] }> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const [run] = await selectRuns(db, project.id, [eq(agentRun.id, runId)], 1, new Date());
  if (!run) throw new NotFoundError(`Unknown agent run ${runId}.`);
  const calls = await db
    .select({
      id: agentCall.id,
      at: agentCall.at,
      tool: agentCall.tool,
      transport: agentCall.transport,
      systemSlug: agentCall.systemSlug,
      target: agentCall.target,
      ok: agentCall.ok,
      status: agentCall.status,
      error: agentCall.error,
      durationMs: agentCall.durationMs,
    })
    .from(agentCall)
    .where(and(eq(agentCall.runId, runId), eq(agentCall.projectId, project.id)))
    .orderBy(asc(agentCall.at), asc(agentCall.id));
  const changes = await selectHistory(
    db,
    [
      eq(changeLog.projectId, project.id),
      eq(changeLog.authorUserId, run.userId),
      sql`${changeLog.agent} is not null`,
      gte(changeLog.createdAt, run.startedAt),
      sql`${changeLog.createdAt} <= ${new Date(run.lastCallAt.getTime() + CHANGE_GRACE_MS).toISOString()}::timestamptz`,
    ],
    200,
  );
  return { run, calls, changes: changes.reverse() };
}

/**
 * Estimates the tokens agents spent on a system: each run's tokens (input, output and
 * cache writes; cache reads are cheap and would dominate) times the system's share of
 * the run's calls. Runs without token data are left out.
 *
 * @returns the runs counted and the rounded tokens, or `null` when no run has token data
 * @throws NotFoundError if the actor cannot see the project or the system does not exist
 */
export async function systemAgentCost(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<{ runs: number; tokens: number } | null> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const sys = await findSystem(db, project.id, systemSlug);
  const mine = await db
    .select({
      runId: agentCall.runId,
      n: count(),
      tokens: sql<number>`coalesce(${agentRun.inputTokens}, 0) + coalesce(${agentRun.outputTokens}, 0) + coalesce(${agentRun.cacheWriteTokens}, 0)`.mapWith(Number),
    })
    .from(agentCall)
    .innerJoin(agentRun, eq(agentRun.id, agentCall.runId))
    .where(
      and(
        eq(agentCall.projectId, project.id),
        eq(agentCall.systemSlug, sys.slug),
        sql`(${agentRun.inputTokens} is not null or ${agentRun.outputTokens} is not null or ${agentRun.cacheReadTokens} is not null or ${agentRun.cacheWriteTokens} is not null)`,
      ),
    )
    .groupBy(agentCall.runId, agentRun.inputTokens, agentRun.outputTokens, agentRun.cacheWriteTokens);
  if (mine.length === 0) return null;
  const totals = await db
    .select({ runId: agentCall.runId, n: count() })
    .from(agentCall)
    .where(inArray(agentCall.runId, mine.map((m) => m.runId)))
    .groupBy(agentCall.runId);
  const all = new Map(totals.map((t) => [t.runId, t.n]));
  const tokens = mine.reduce((sum, m) => sum + (m.tokens * m.n) / (all.get(m.runId) ?? m.n), 0);
  return { runs: mine.length, tokens: Math.round(tokens) };
}
