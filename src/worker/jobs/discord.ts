import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { adr, adrSystem, board, boardColumn, changeLog, discordOutbox, project, projectWebhook, question, system } from "@/db/schema";
import type { Executor } from "@/db/types";
import { formatAdrNumber } from "@/lib/adr-number";
import { decryptSecret } from "@/lib/crypto";
import { buildDigest, buildDiscordBatches, plainMessage, type DigestData, type DiscordItem, type DiscordMessage } from "@/lib/discord-format";
import { QUEUE } from "@/lib/queue";
import { SITE_NAME, siteUrl } from "@/lib/site";
import type { WorkerDeps } from "../deps";
import { registerJob, registerRepeatable } from "../jobs";

/** Pending rows one flush posts at most; more schedule a follow-up flush. */
const BATCH = 50;
const TIMEOUT_MS = 10_000;
const FOLLOW_UP_DELAY_MS = 2_000;
/** How long a flush waits when another flush of the webhook holds the lock. */
const BUSY_DELAY_MS = 5_000;
/** How long a flush or digest lock lives at most; a flush posts at most 5 messages of 10 s each. */
const LOCK_SECONDS = 60;
/** 429 retries, or re-queues behind a held lock, in a row before the job fails and BullMQ's backoff takes over. */
const MAX_RETRIES = 10;
const DAY_MS = 86_400_000;
const DISABLED_REASON = "Discord no longer accepts this webhook (404). Create a new webhook and paste its URL.";

const webhookData = z.object({ webhookId: z.string().min(1), retry: z.number().int().min(0).optional(), busy: z.number().int().min(0).optional() });

/** How Discord answered one message. */
type Sent =
  | { kind: "sent" }
  | { kind: "retry"; delayMs: number }
  /** 401 or 404: the webhook is gone. */
  | { kind: "gone"; status: number }
  /** Any other 4xx: Discord refuses this message, so it is dropped. */
  | { kind: "rejected" }
  /** 5xx or a network error: worth retrying. */
  | { kind: "failed"; error: Error };

/** Reads `retry_after` in seconds from a 429's JSON body or its `Retry-After` header; 1 when neither has it. */
async function retryAfterSeconds(res: Response): Promise<number> {
  const body: unknown = await res.json().catch(() => null);
  const fromBody = body && typeof body === "object" && "retry_after" in body ? Number(body.retry_after) : NaN;
  if (Number.isFinite(fromBody) && fromBody >= 0) return fromBody;
  const fromHeader = Number(res.headers.get("retry-after"));
  return Number.isFinite(fromHeader) && fromHeader >= 0 ? fromHeader : 1;
}

/** Posts one message to the webhook. Errors name the webhook id, never its URL. */
async function send(webhookId: string, url: string, message: DiscordMessage): Promise<Sent> {
  let res: Response;
  try {
    res = await fetch(url + "?wait=true", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "failed", error: new Error(`Discord request for webhook ${webhookId} failed: ${error instanceof Error ? error.message : String(error)}`) };
  }
  if (res.ok) return { kind: "sent" };
  if (res.status === 429) return { kind: "retry", delayMs: Math.ceil((await retryAfterSeconds(res)) * 1000) + 250 };
  if (res.status === 401 || res.status === 404) return { kind: "gone", status: res.status };
  if (res.status >= 500) return { kind: "failed", error: new Error(`Discord answered ${res.status} for webhook ${webhookId}`) };
  console.error(`Discord refused a message for webhook ${webhookId} with ${res.status}; dropped it.`);
  return { kind: "rejected" };
}

/** Turns a webhook off because Discord no longer accepts it. */
async function disable(tx: Executor, webhookId: string, status: number): Promise<void> {
  await tx.update(projectWebhook).set({ enabled: false, disabledReason: DISABLED_REASON }).where(eq(projectWebhook.id, webhookId));
  console.warn(`Discord answered ${status} for webhook ${webhookId}; disabled it.`);
}

/** Runs `fn` while holding the Kv lock `key`; returns false without running it when another holder has it. */
async function withLock(deps: WorkerDeps, key: string, fn: () => Promise<void>): Promise<boolean> {
  if (!(await deps.kv.setIfAbsent(key, "1", LOCK_SECONDS))) return false;
  try {
    await fn();
  } finally {
    await deps.kv.del(key);
  }
  return true;
}

/**
 * Posts the webhook's pending outbox rows, oldest first and at most 50. A Kv lock keeps flushes of one webhook from
 * overlapping, and no transaction stays open while Discord answers. A 429 schedules a retry after `retry_after`
 * (at most 10 in a row); 401 or 404 disables the webhook.
 *
 * Delivery is at least once: a crash between a post and marking its rows sent posts them again.
 *
 * @throws Error on a 5xx, a network error, or an 11th 429 or held lock in a row, so the job is retried; rows posted before stay sent
 */
export async function flushWebhook(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { webhookId, retry = 0, busy = 0 } = webhookData.parse(raw);
  const now = deps.now();
  const bucket = Math.floor(now.getTime() / 10_000);
  const queue = deps.queue("deliver");
  const ran = await withLock(deps, `discord-flush:${webhookId}`, async () => {
    const loaded = await deps.db.transaction(async (tx) => {
      const [hook] = await tx.select({ enabled: projectWebhook.enabled, urlEnc: projectWebhook.urlEnc }).from(projectWebhook).where(eq(projectWebhook.id, webhookId));
      if (!hook?.enabled) return null;
      const pending = await tx
        .select({ id: discordOutbox.id, payload: discordOutbox.payload })
        .from(discordOutbox)
        .where(and(eq(discordOutbox.webhookId, webhookId), isNull(discordOutbox.sentAt)))
        .orderBy(asc(discordOutbox.createdAt), asc(discordOutbox.id))
        .limit(BATCH);
      return { urlEnc: hook.urlEnc, pending };
    });
    if (!loaded) return;
    const rows = loaded.pending;
    if (rows.length === 0) return;
    const url = decryptSecret(loaded.urlEnc);
    for (const batch of buildDiscordBatches(rows.map((r) => r.payload as DiscordItem))) {
      const sent = await send(webhookId, url, batch.message);
      if (sent.kind === "gone") return disable(deps.db, webhookId, sent.status);
      if (sent.kind === "failed") throw sent.error;
      if (sent.kind === "retry") {
        const n = retry + 1;
        if (n > MAX_RETRIES) throw new Error(`Discord rate-limited webhook ${webhookId} ${n} times in a row`);
        await queue.add("discord.flush", { webhookId, retry: n }, { jobId: `discord-flush-${webhookId}-${bucket}-retry-${n}`, delayMs: sent.delayMs });
        return;
      }
      const ids = batch.items.map((i) => rows[i].id);
      if (sent.kind === "rejected") console.error(`Dropped outbox rows ${ids.join(", ")} of webhook ${webhookId}.`);
      await deps.db.transaction(async (tx) => {
        await tx.update(discordOutbox).set({ sentAt: now }).where(inArray(discordOutbox.id, ids));
        if (sent.kind === "sent") await tx.update(projectWebhook).set({ lastSentAt: now }).where(eq(projectWebhook.id, webhookId));
      });
    }
    // Rows beyond this batch, or queued while it posted, get a follow-up before the lock is released.
    const [left] = await deps.db
      .select({ id: discordOutbox.id })
      .from(discordOutbox)
      .where(and(eq(discordOutbox.webhookId, webhookId), isNull(discordOutbox.sentAt)))
      .limit(1);
    if (left) {
      // Its own id: the running job's id may be in this same bucket, and BullMQ ignores an id it still keeps.
      const lastId = rows[rows.length - 1].id;
      await queue.add("discord.flush", { webhookId }, { jobId: `discord-flush-${webhookId}-${bucket}-next-${lastId}`, delayMs: FOLLOW_UP_DELAY_MS });
    }
  });
  if (ran) return;
  const n = busy + 1;
  if (n > MAX_RETRIES) throw new Error(`Another flush of webhook ${webhookId} held the lock ${n} times in a row`);
  await queue.add("discord.flush", { webhookId, retry, busy: n }, { jobId: `discord-flush-${webhookId}-${bucket}-busy-${n}`, delayMs: BUSY_DELAY_MS });
}

/**
 * Posts a test message to the webhook; 401 or 404 disables it.
 *
 * @throws Error on a 429, a 5xx or a network error, so the job is retried
 */
export async function sendTestMessage(deps: WorkerDeps, raw: unknown): Promise<void> {
  const { webhookId } = webhookData.parse(raw);
  const [hook] = await deps.db
    .select({ urlEnc: projectWebhook.urlEnc, projectName: project.name, projectSlug: project.slug })
    .from(projectWebhook)
    .innerJoin(project, eq(project.id, projectWebhook.projectId))
    .where(eq(projectWebhook.id, webhookId));
  if (!hook) return;
  const text = `Test message from ${SITE_NAME} for ${hook.projectName}. Notifications will appear here.`;
  const sent = await send(webhookId, decryptSecret(hook.urlEnc), plainMessage(text, new URL(`/p/${hook.projectSlug}`, siteUrl()).href, hook.projectName));
  if (sent.kind === "gone") await disable(deps.db, webhookId, sent.status);
  else if (sent.kind === "retry") throw new Error(`Discord rate-limited the test message for webhook ${webhookId}`);
  else if (sent.kind === "failed") throw sent.error;
  else if (sent.kind === "sent") await deps.db.update(projectWebhook).set({ lastSentAt: deps.now() }).where(eq(projectWebhook.id, webhookId));
}

/** Returns whether it is Monday between 09:00 and 09:59 at `now` in `timeZone`. */
export function isDigestHour(now: Date, timeZone: string): boolean {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(now);
    return parts.find((p) => p.type === "weekday")?.value === "Mon" && Number(parts.find((p) => p.type === "hour")?.value) === 9;
  } catch {
    return false;
  }
}

/** Returns whether a webhook last got its digest more than 6 days before `now`, or never. */
function digestDue(lastDigestAt: Date | null, now: Date): boolean {
  return lastDigestAt === null || now.getTime() - lastDigestAt.getTime() > 6 * DAY_MS;
}

/** Collects the digest of the 7 days before `now`, limited to the webhook's boards; items without a system count only on all boards. */
async function digestData(
  tx: Executor,
  hook: { projectId: string; projectName: string; projectSlug: string; boardIds: string[] },
  now: Date,
): Promise<DigestData> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const [columns, systems, moves, questions, accepted] = await Promise.all([
    tx
      .select({ board: board.name, column: boardColumn.name, category: boardColumn.category })
      .from(boardColumn)
      .innerJoin(board, eq(board.id, boardColumn.boardId))
      .where(eq(board.projectId, hook.projectId)),
    tx
      .select({ id: system.id, title: system.title, boardId: system.boardId, category: boardColumn.category, archivedAt: system.archivedAt })
      .from(system)
      .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
      .where(eq(system.projectId, hook.projectId))
      .orderBy(asc(system.title)),
    tx
      .select({ systemId: changeLog.entityId, value: changeLog.newValue })
      .from(changeLog)
      .where(and(eq(changeLog.projectId, hook.projectId), eq(changeLog.entity, "system"), eq(changeLog.field, "column"), gte(changeLog.createdAt, since)))
      .orderBy(asc(changeLog.id)),
    tx
      .select({ title: question.title, priority: question.priority, systemId: question.systemId })
      .from(question)
      .where(and(eq(question.projectId, hook.projectId), eq(question.resolved, false)))
      .orderBy(asc(question.createdAt)),
    tx
      .select({ id: adr.id, number: adr.number, title: adr.title, systemId: adrSystem.systemId })
      .from(changeLog)
      .innerJoin(adr, eq(adr.id, changeLog.entityId))
      .leftJoin(adrSystem, eq(adrSystem.adrId, adr.id))
      .where(and(eq(changeLog.projectId, hook.projectId), eq(changeLog.entity, "adr"), eq(changeLog.field, "status"), eq(changeLog.newValue, "accepted"), gte(changeLog.createdAt, since)))
      .orderBy(asc(adr.number)),
  ]);

  const categoryOf = new Map(columns.map((c) => [`${c.board} / ${c.column}`, c.category]));
  const byId = new Map(systems.map((s) => [s.id, s]));
  const covered = (systemIds: string[]) => {
    if (systemIds.length === 0) return hook.boardIds.length === 0;
    return systemIds.some((id) => {
      const s = byId.get(id);
      return s !== undefined && s.archivedAt === null && (hook.boardIds.length === 0 || hook.boardIds.includes(s.boardId));
    });
  };
  const movedInto = (category: string) => {
    const ids = new Set(moves.filter((m) => m.value !== null && categoryOf.get(m.value) === category && covered([m.systemId])).map((m) => m.systemId));
    return [...ids].map((id) => byId.get(id)!.title);
  };

  const decisions = new Map<string, { label: string; systemIds: string[] }>();
  for (const row of accepted) {
    const entry = decisions.get(row.id) ?? { label: `ADR-${formatAdrNumber(row.number)}: ${row.title}`, systemIds: [] };
    if (row.systemId) entry.systemIds.push(row.systemId);
    decisions.set(row.id, entry);
  }

  return {
    projectName: hook.projectName,
    href: new URL(`/p/${hook.projectSlug}`, siteUrl()).href,
    shipped: movedInto("done"),
    started: movedInto("active"),
    blocked: systems.filter((s) => s.category === "blocked" && covered([s.id])).map((s) => s.title),
    questions: questions.filter((q) => covered(q.systemId ? [q.systemId] : [])).map((q) => ({ title: q.title, blocking: q.priority === "blocking" })),
    accepted: [...decisions.values()].filter((d) => covered(d.systemIds)).map((d) => d.label),
  };
}

/**
 * Sends one webhook its weekly digest unless another run already did. A Kv lock keeps two runs from sending it
 * twice; the digest is built in a short transaction, sent outside it, and `lastDigestAt` is set only while still due.
 * Sends nothing when every section is empty; 401 or 404 disables the webhook.
 *
 * @throws Error on a 429, a 5xx or a network error
 */
async function sendDigest(deps: WorkerDeps, webhookId: string, now: Date): Promise<void> {
  await withLock(deps, `discord-digest:${webhookId}`, async () => {
    const built = await deps.db.transaction(async (tx) => {
      const [hook] = await tx
        .select({
          projectId: projectWebhook.projectId,
          urlEnc: projectWebhook.urlEnc,
          boardIds: projectWebhook.boardIds,
          enabled: projectWebhook.enabled,
          digest: projectWebhook.digest,
          lastDigestAt: projectWebhook.lastDigestAt,
          projectName: project.name,
          projectSlug: project.slug,
        })
        .from(projectWebhook)
        .innerJoin(project, eq(project.id, projectWebhook.projectId))
        .where(eq(projectWebhook.id, webhookId));
      if (!hook?.enabled || !hook.digest || !digestDue(hook.lastDigestAt, now)) return null;
      const message = buildDigest(await digestData(tx, hook, now));
      return message && { urlEnc: hook.urlEnc, message };
    });
    if (!built) return;
    const sent = await send(webhookId, decryptSecret(built.urlEnc), built.message);
    if (sent.kind === "gone") await disable(deps.db, webhookId, sent.status);
    else if (sent.kind === "retry") throw new Error(`Discord rate-limited the weekly digest for webhook ${webhookId}`);
    else if (sent.kind === "failed") throw sent.error;
    else if (sent.kind === "sent") {
      const due = or(isNull(projectWebhook.lastDigestAt), lt(projectWebhook.lastDigestAt, new Date(now.getTime() - 6 * DAY_MS)));
      await deps.db.update(projectWebhook).set({ lastDigestAt: now, lastSentAt: now }).where(and(eq(projectWebhook.id, webhookId), due));
    }
  });
}

/**
 * Sends the weekly digest to every enabled digest webhook of an active project where it is Monday 09:00–09:59 in its
 * time zone and whose last digest is more than 6 days old.
 *
 * @throws Error naming the webhooks whose digest failed, after trying all of them, so the job is retried
 */
export async function sendDigests(deps: WorkerDeps): Promise<void> {
  const now = deps.now();
  const hooks = await deps.db
    .select({ id: projectWebhook.id, timeZone: projectWebhook.timeZone, lastDigestAt: projectWebhook.lastDigestAt })
    .from(projectWebhook)
    .innerJoin(project, eq(project.id, projectWebhook.projectId))
    .where(and(eq(projectWebhook.digest, true), eq(projectWebhook.enabled, true), isNull(project.archivedAt)));
  const failed: string[] = [];
  for (const hook of hooks.filter((h) => isDigestHour(now, h.timeZone) && digestDue(h.lastDigestAt, now))) {
    try {
      await sendDigest(deps, hook.id, now);
    } catch (error) {
      console.error(`Weekly digest for webhook ${hook.id} failed`, error);
      failed.push(hook.id);
    }
  }
  if (failed.length > 0) throw new Error(`Weekly digest failed for webhooks ${failed.join(", ")}`);
}

// Retries come from DEFAULT_JOB_OPTIONS: 5 attempts with exponential backoff from 5 s.
registerJob(QUEUE.deliver, "discord.flush", (data, deps) => flushWebhook(deps, data));
registerJob(QUEUE.deliver, "discord.test", (data, deps) => sendTestMessage(deps, data));
registerJob(QUEUE.maintenance, "digest.weekly", (_data, deps) => sendDigests(deps));
registerRepeatable(QUEUE.maintenance, "digest.weekly", { cron: "5 * * * *", tz: "UTC" });
