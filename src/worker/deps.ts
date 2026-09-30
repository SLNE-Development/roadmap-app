import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { memoryBus, valkeyBus, type EventBus } from "@/lib/bus";
import { memoryKv, valkeyKv, type Kv } from "@/lib/kv";
import { bullQueue, memoryQueue, QUEUE, type JobQueue, type MemoryQueue } from "@/lib/queue";

/** Everything a job handler may touch; injected so tests can swap in memory twins. */
export interface WorkerDeps {
  db: Db;
  kv: Kv;
  bus: EventBus;
  queue: (name: keyof typeof QUEUE) => JobQueue;
  now: () => Date;
}

/** Dependencies backed by Postgres and Valkey. */
export function productionDeps(): WorkerDeps {
  return {
    db: getDb(),
    kv: valkeyKv(),
    bus: valkeyBus(),
    queue: (name) => bullQueue(QUEUE[name]),
    now: () => new Date(),
  };
}

/** In-memory dependencies for tests; `queues` exposes the recorded jobs of each queue. */
export function testDeps(
  db: Db,
  overrides: Partial<WorkerDeps> = {},
): WorkerDeps & { queues: Record<keyof typeof QUEUE, MemoryQueue> } {
  const queues = {
    feed: memoryQueue(),
    deliver: memoryQueue(),
    github: memoryQueue(),
    maintenance: memoryQueue(),
  };
  return {
    db,
    kv: memoryKv(),
    bus: memoryBus(),
    queue: (name) => queues[name],
    now: () => new Date(),
    ...overrides,
    queues,
  };
}
