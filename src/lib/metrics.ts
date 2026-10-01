import { sql } from "drizzle-orm";
import { changeLog, feedCursor } from "@/db/schema";
import type { Db } from "@/db/types";
import { HEARTBEAT_KEY } from "@/worker/heartbeat";
import type { Kv } from "./kv";
import { QUEUE, type QueueName } from "./queue";

export interface Metric {
  name: string;
  help: string;
  type: "gauge" | "counter";
  collect: () => Promise<{ labels?: Record<string, string>; value: number }[]>;
}

/** A heartbeat this many milliseconds old or older means the worker is stale. */
export const HEARTBEAT_MAX_AGE_MS = 30_000;

/** Whether the worker heartbeat in `kv` is less than 30 s old at `now`. */
export async function workerAlive(kv: Kv, now: Date): Promise<boolean> {
  const beat = await kv.get(HEARTBEAT_KEY);
  if (!beat) return false;
  const at = Date.parse(beat);
  return !Number.isNaN(at) && now.getTime() - at < HEARTBEAT_MAX_AGE_MS;
}

const registry: Metric[] = [];

/**
 * Adds a metric to the process-wide registry served by `/api/metrics`.
 *
 * @throws Error if a metric with the same name is registered
 */
export function registerMetric(metric: Metric): void {
  if (registry.some((m) => m.name === metric.name)) throw new Error(`Metric ${metric.name} is already registered`);
  registry.push(metric);
}

/** Escapes a label value for the Prometheus text format. */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/** Longest a single collector may take before it counts as failed. */
export const COLLECT_TIMEOUT_MS = 2_000;

/** Rejects when `work` takes longer than `ms`, so a hung Valkey call cannot stall a scrape. */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Renders metrics in Prometheus text format 0.0.4; a failing or timed-out collector renders only its HELP and
 * TYPE lines.
 */
export async function renderMetrics(metrics: Metric[] = registry, timeoutMs = COLLECT_TIMEOUT_MS): Promise<string> {
  const out: string[] = [];
  for (const metric of metrics) {
    out.push(`# HELP ${metric.name} ${metric.help}`, `# TYPE ${metric.name} ${metric.type}`);
    try {
      for (const sample of await withTimeout(metric.collect(), timeoutMs)) {
        const labels = Object.entries(sample.labels ?? {}).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
        out.push(`${metric.name}${labels.length ? `{${labels.join(",")}}` : ""} ${sample.value}`);
      }
    } catch (error) {
      console.error(`metric ${metric.name} failed to collect`, error);
    }
  }
  return out.join("\n") + "\n";
}

/** Registers the built-in platform metrics; `register` is injectable for tests. */
export function registerBuiltinMetrics(
  deps: {
    db: Db;
    kv: Kv;
    queueCounts: (q: QueueName) => Promise<Record<string, number>>;
    pingValkey: () => Promise<boolean>;
  },
  register: (metric: Metric) => void = registerMetric,
): void {
  const gauge = (name: string, help: string, collect: Metric["collect"]) =>
    register({ name, help, type: "gauge", collect });
  gauge("roadmap_db_up", "1 when the database answers.", async () => {
    try {
      await deps.db.execute(sql`select 1`);
      return [{ value: 1 }];
    } catch {
      return [{ value: 0 }];
    }
  });
  gauge("roadmap_valkey_up", "1 when Valkey answers.", async () => [{ value: (await deps.pingValkey()) ? 1 : 0 }]);
  gauge("roadmap_worker_up", "1 when the worker heartbeat is less than 30 s old.", async () => [
    { value: (await workerAlive(deps.kv, new Date())) ? 1 : 0 },
  ]);
  gauge("roadmap_queue_jobs", "Jobs per queue and state.", async () => {
    const samples: { labels: Record<string, string>; value: number }[] = [];
    for (const queue of Object.values(QUEUE)) {
      const counts = await deps.queueCounts(queue);
      for (const state of ["waiting", "active", "delayed", "failed"]) {
        samples.push({ labels: { queue, state }, value: counts[state] ?? 0 });
      }
    }
    return samples;
  });
  gauge("roadmap_feed_lag", "Change log entries a feed consumer has not yet processed.", async () => {
    const [{ max }] = await deps.db.select({ max: sql<number>`coalesce(max(${changeLog.id}), 0)::int` }).from(changeLog);
    const cursors = await deps.db.select().from(feedCursor);
    return cursors.map((c) => ({ labels: { consumer: c.name }, value: Math.max(0, max - c.lastId) }));
  });
  gauge("roadmap_feed_cursor", "Last change log id processed by a feed consumer.", async () =>
    (await deps.db.select().from(feedCursor)).map((c) => ({ labels: { consumer: c.name }, value: c.lastId })),
  );
}
