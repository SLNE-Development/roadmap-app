import { Queue, Worker } from "bullmq";
import type Redis from "ioredis";
import { QUEUE, type QueueName } from "@/lib/queue";
import type { WorkerDeps } from "./deps";

export type JobHandler = (data: unknown, deps: WorkerDeps) => Promise<void>;
type Schedule = { everyMs: number } | { cron: string };
type Repeatable = { queue: QueueName; jobName: string; schedule: Schedule; data?: unknown };

const handlers = new Map<string, JobHandler>();
const repeatables: Repeatable[] = [];

const key = (queue: QueueName, jobName: string) => `${queue}/${jobName}`;

/**
 * Registers the handler for a job.
 *
 * @throws Error if the job is already registered
 */
export function registerJob(queue: QueueName, jobName: string, handle: JobHandler): void {
  const id = key(queue, jobName);
  if (handlers.has(id)) throw new Error(`Job ${id} is already registered`);
  handlers.set(id, handle);
}

/** Schedules a registered job to recur; `startWorkers` upserts the scheduler. */
export function registerRepeatable(queue: QueueName, jobName: string, schedule: Schedule, data?: unknown): void {
  repeatables.push({ queue, jobName, schedule, data });
}

/**
 * Runs the handler registered for a job.
 *
 * @throws Error if no handler is registered
 */
export function runJob(queue: QueueName, jobName: string, data: unknown, deps: WorkerDeps): Promise<void> {
  const handle = handlers.get(key(queue, jobName));
  if (!handle) return Promise.reject(new Error(`No handler for job ${key(queue, jobName)}`));
  return handle(data, deps);
}

export function registeredJobs(): { queue: QueueName; jobName: string }[] {
  return [...handlers.keys()].map((id) => {
    const [queue, jobName] = id.split("/") as [QueueName, string];
    return { queue, jobName };
  });
}

export function registeredRepeatables(): Repeatable[] {
  return [...repeatables];
}

/**
 * Starts one BullMQ worker per queue that has handlers and upserts the repeatable job schedulers.
 *
 * @returns a function that closes every worker
 * @throws Error if a repeatable has no registered handler
 */
export async function startWorkers(deps: WorkerDeps, connection: Redis): Promise<() => Promise<void>> {
  for (const r of repeatables) {
    if (!handlers.has(key(r.queue, r.jobName))) {
      throw new Error(`Repeatable ${key(r.queue, r.jobName)} has no registered handler`);
    }
  }
  const workers = [...new Set(registeredJobs().map((job) => job.queue))].map(
    (queue) =>
      new Worker(queue, (job) => runJob(queue, job.name, job.data, deps), {
        connection,
        prefix: "roadmap",
        concurrency: queue === QUEUE.deliver ? 5 : 1,
      }),
  );
  for (const r of repeatables) {
    const queue = new Queue(r.queue, { connection, prefix: "roadmap" });
    try {
      await queue.upsertJobScheduler(
        `${r.queue}-${r.jobName}`,
        "everyMs" in r.schedule ? { every: r.schedule.everyMs } : { pattern: r.schedule.cron },
        { name: r.jobName, data: r.data },
      );
    } finally {
      await queue.close();
    }
  }
  return async () => {
    await Promise.all(workers.map((worker) => worker.close()));
  };
}
