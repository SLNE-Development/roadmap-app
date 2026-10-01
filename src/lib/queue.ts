import { Queue } from "bullmq";
import type Redis from "ioredis";
import { getProducerValkey } from "./valkey";

/** Names of the BullMQ queues. */
export const QUEUE = { feed: "feed", deliver: "deliver", github: "github", maintenance: "maintenance" } as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface JobOptions {
  jobId?: string;
  delayMs?: number;
  /** Tries in all, overriding the default of 5. */
  attempts?: number;
  /** First retry delay of the exponential backoff, overriding the default of 5 s. */
  backoffMs?: number;
}

/** Minimal job queue; BullMQ in production, in memory in unit tests. */
export interface JobQueue {
  add(jobName: string, data: unknown, opts?: JobOptions): Promise<void>;
}

export interface MemoryQueue extends JobQueue {
  jobs: { jobName: string; data: unknown; opts: JobOptions }[];
}

/** Retry and retention defaults for every job. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
} as const;

/**
 * Checks a job id against BullMQ's restrictions.
 *
 * @throws Error if the id contains ':' or is purely numeric
 */
function validateJobId(id: string): void {
  if (id.includes(":")) throw new Error("Job ids must not contain ':'");
  if (/^\d+$/.test(id)) throw new Error("Job ids must not be purely numeric");
}

/** In-memory queue that records jobs and ignores a repeated job id, as BullMQ does. */
export function memoryQueue(): MemoryQueue {
  const jobs: MemoryQueue["jobs"] = [];
  return {
    jobs,
    async add(jobName, data, opts = {}) {
      if (opts.jobId !== undefined) {
        validateJobId(opts.jobId);
        if (jobs.some((job) => job.opts.jobId === opts.jobId)) return;
      }
      jobs.push({ jobName, data, opts });
    },
  };
}

const queues = new Map<QueueName, Queue>();

/**
 * Returns the cached BullMQ queue for `name`, creating it on first use. Its connection defaults to the
 * fail-fast producer client, so `add` rejects quickly while Valkey is down.
 */
export function bullQueueRaw(name: QueueName, opts?: { connection?: Redis }): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection: opts?.connection ?? getProducerValkey(),
      prefix: "roadmap",
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    });
    queues.set(name, queue);
  }
  return queue;
}

/** Job queue backed by BullMQ on Valkey. */
export function bullQueue(name: QueueName, opts?: { connection?: Redis }): JobQueue {
  return {
    async add(jobName, data, jobOpts = {}) {
      if (jobOpts.jobId !== undefined) validateJobId(jobOpts.jobId);
      // BullMQ spreads these over its defaults, so retry settings are only set when given.
      await bullQueueRaw(name, opts).add(jobName, data, {
        jobId: jobOpts.jobId,
        delay: jobOpts.delayMs,
        ...(jobOpts.attempts === undefined ? {} : { attempts: jobOpts.attempts }),
        ...(jobOpts.backoffMs === undefined ? {} : { backoff: { type: "exponential", delay: jobOpts.backoffMs } }),
      });
    },
  };
}

/** How long a web request waits for an enqueue before giving up. */
const ENQUEUE_TIMEOUT_MS = 5_000;

/**
 * Adds a job, giving up after 5 s so a web request never hangs while Valkey is down.
 *
 * @throws Error if the queue rejects the job or does not answer in time
 */
export async function addWithTimeout(queue: JobQueue, jobName: string, data: unknown, opts?: JobOptions): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("enqueueing timed out")), ENQUEUE_TIMEOUT_MS);
    });
    await Promise.race([queue.add(jobName, data, opts), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
