import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { agentCall, agentRun, project } from "@/db/schema";
import type { Db, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

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
