import { writeFile } from "node:fs/promises";
import { closeDb } from "@/db/client";
import { requireEnv, WORKER_REQUIRED_ENV } from "@/lib/env";
import { closeValkey, getValkey } from "@/lib/valkey";
import "./consumers";
import { productionDeps } from "./deps";
import { beat } from "./heartbeat";
import { registeredJobs, startWorkers } from "./jobs";

/** Entry point of the worker process. */
async function main(): Promise<void> {
  requireEnv(WORKER_REQUIRED_ENV);
  const deps = productionDeps();
  const stop = await startWorkers(deps, getValkey());

  const jobs = registeredJobs();
  const queues = [...new Set(jobs.map((job) => job.queue))];
  const consumers = jobs.map((job) => `${job.queue}/${job.jobName}`);
  console.log(`worker started: queues=${queues.join(",")} consumers=${consumers.join(",")}`);

  const tick = () => beat(deps, writeFile).catch((error: unknown) => console.warn("heartbeat failed", error));
  void tick();
  const heartbeat = setInterval(tick, 10_000);

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(1), 30_000).unref();
    clearInterval(heartbeat);
    await stop();
    await closeValkey();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
