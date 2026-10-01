import { and, eq, sql } from "drizzle-orm";
import { changeLog, feedCursor, feedSeen } from "@/db/schema";
import { newId } from "@/lib/id";
import type { WorkerDeps } from "./deps";

/** One row of `change_log`, as delivered to feed consumers. */
export type ChangeEvent = typeof changeLog.$inferSelect;

/** Handles a batch of change events in id order. */
export type FeedHandler = (events: ChangeEvent[], deps: WorkerDeps) => Promise<void>;

/** A named consumer of the change feed; its cursor is stored under `name`. */
export interface FeedConsumer {
  name: string;
  handle: FeedHandler;
  /** Replay the whole `change_log` on the first run instead of starting at its head. */
  fromStart?: boolean;
}

/** Tuning of the feed loop: batch size, how far back late ids are still picked up, tick interval, lease length. */
export const FEED_DEFAULTS = { batchSize: 200, lookbackMs: 5 * 60_000, lookbackIds: 5_000, intervalMs: 1_000, leaseSeconds: 10 };

const LOCK_KEY = "feed:lock";
const processHolder = newId();
const consumers = new Map<string, FeedConsumer>();

/**
 * Registers a consumer of the change feed.
 *
 * Delivery is at least once: a crash between `handle` and recording the delivery redelivers
 * the batch, so handlers must be idempotent, keyed by `event.id`.
 *
 * @throws Error if a consumer with this name is already registered
 */
export function registerFeedConsumer(name: string, handle: FeedHandler, opts: { fromStart?: boolean } = {}): void {
  if (consumers.has(name)) throw new Error(`Feed consumer ${name} is already registered`);
  consumers.set(name, { name, handle, fromStart: opts.fromStart });
}

/** The consumers registered so far. */
export function registeredFeedConsumers(): FeedConsumer[] {
  return [...consumers.values()];
}

/**
 * Runs one pass of the feed: takes the lease, then delivers a batch to each consumer in turn.
 *
 * A consumer that throws keeps its cursor and is retried with the same events on the next tick;
 * the others are unaffected. Ids that commit late are still delivered while they fall within
 * `lookbackIds` of the cursor and `lookbackMs` of their creation, and exactly once thanks to `feed_seen`.
 *
 * @param deps worker dependencies
 * @param list the consumers to run
 * @param opts overrides of {@link FEED_DEFAULTS}, and the lease holder id
 * @returns the result per consumer, or `null` when another holder has the lease
 */
export async function runFeedTick(
  deps: WorkerDeps,
  list: FeedConsumer[],
  opts: Partial<typeof FEED_DEFAULTS> & { holder?: string } = {},
): Promise<{ consumer: string; delivered: number; error?: string }[] | null> {
  const { batchSize, lookbackMs, lookbackIds, leaseSeconds } = { ...FEED_DEFAULTS, ...opts };
  const holder = opts.holder ?? processHolder;
  if (!(await deps.kv.setIfAbsent(LOCK_KEY, holder, leaseSeconds))) {
    if ((await deps.kv.get(LOCK_KEY)) !== holder) return null;
    await deps.kv.set(LOCK_KEY, holder, leaseSeconds);
  }

  const results: { consumer: string; delivered: number; error?: string }[] = [];
  for (const consumer of list) {
    // Re-check and extend the lease before each consumer, so a slow tick cannot outlive it.
    if ((await deps.kv.get(LOCK_KEY)) !== holder) return results;
    await deps.kv.set(LOCK_KEY, holder, leaseSeconds);
    const { db } = deps;
    let [cursorRow] = await db.select().from(feedCursor).where(eq(feedCursor.name, consumer.name));
    if (!cursorRow) {
      const [head] = await db.select({ id: sql<number>`coalesce(max(${changeLog.id}), 0)::float8` }).from(changeLog);
      // A consumer starting at the head must not pick the recent history up again through the lookback,
      // so rows inside the lookback window are marked as seen.
      await db.transaction(async (tx) => {
        await tx
          .insert(feedCursor)
          .values({ name: consumer.name, lastId: consumer.fromStart ? 0 : head.id })
          .onConflictDoNothing();
        if (!consumer.fromStart) {
          await tx.execute(sql`
            insert into ${feedSeen} (consumer, change_id)
            select ${consumer.name}, id from ${changeLog}
            where id <= ${head.id} and id > ${head.id - lookbackIds}
              and created_at > now() - make_interval(secs => ${lookbackMs / 1000})
            on conflict do nothing`);
        }
      });
      [cursorRow] = await db.select().from(feedCursor).where(eq(feedCursor.name, consumer.name));
    }
    const cursor = cursorRow.lastId;

    const events = await db
      .select()
      .from(changeLog)
      .where(
        and(
          sql`(${changeLog.id} > ${cursor} or (${changeLog.id} > ${cursor - lookbackIds} and ${changeLog.createdAt} > now() - make_interval(secs => ${lookbackMs / 1000})))`,
          sql`not exists (select 1 from ${feedSeen} where ${feedSeen.consumer} = ${consumer.name} and ${feedSeen.changeId} = ${changeLog.id})`,
        ),
      )
      .orderBy(changeLog.id)
      .limit(batchSize);
    if (events.length === 0) {
      results.push({ consumer: consumer.name, delivered: 0 });
      continue;
    }

    try {
      await consumer.handle(events, deps);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`feed consumer ${consumer.name} failed`, error);
      results.push({ consumer: consumer.name, delivered: 0, error: message });
      continue;
    }

    const maxId = Math.max(...events.map((e) => e.id));
    await db.transaction(async (tx) => {
      await tx
        .insert(feedSeen)
        .values(events.map((e) => ({ consumer: consumer.name, changeId: e.id })))
        .onConflictDoNothing();
      await tx
        .update(feedCursor)
        .set({ lastId: sql`greatest(${feedCursor.lastId}, ${maxId})`, updatedAt: sql`now()` })
        .where(eq(feedCursor.name, consumer.name));
    });
    results.push({ consumer: consumer.name, delivered: events.length });
  }
  return results;
}

/**
 * Loops {@link runFeedTick} every `intervalMs`, immediately again while a tick delivered a full batch.
 *
 * @returns a function that resolves once the current tick has finished and no further tick will start
 */
export function startFeed(
  deps: WorkerDeps,
  list: FeedConsumer[] = registeredFeedConsumers(),
  opts: Partial<typeof FEED_DEFAULTS> = {},
): () => Promise<void> {
  const { batchSize, intervalMs } = { ...FEED_DEFAULTS, ...opts };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const loop = async (): Promise<void> => {
    let again = false;
    try {
      const results = await runFeedTick(deps, list, opts);
      again = results?.some((r) => r.delivered >= batchSize) ?? false;
    } catch (error) {
      console.error("feed tick failed", error);
    }
    if (stopped) return;
    timer = setTimeout(() => {
      running = loop();
    }, again ? 0 : intervalMs);
  };
  running = loop();

  return async () => {
    stopped = true;
    clearTimeout(timer);
    await running;
  };
}
