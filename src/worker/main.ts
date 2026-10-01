import { writeFile } from "node:fs/promises";
import { closeDb } from "@/db/client";
import { checkEncryptionKey } from "@/lib/crypto";
import { requireEnv, WORKER_REQUIRED_ENV } from "@/lib/env";
import { checkUploadsDir } from "@/lib/ops/uploads";
import { uploadsDir } from "@/lib/uploads";
import { closeValkey, getProducerValkey, getValkey } from "@/lib/valkey";
import "./consumers";
import { productionDeps } from "./deps";
import { registeredFeedConsumers, startFeed } from "./feed";
import { beat } from "./heartbeat";
import { registeredJobs, startWorkers } from "./jobs";

const PRODUCER_READY_MS = 5000;

/**
 * Waits up to 5 s for the fail-fast producer client to connect: it has no offline queue, so a command sent
 * before it is ready is rejected ("Stream isn't writeable"). Never throws; a Valkey outage just means a late start.
 */
async function waitForProducer(): Promise<void> {
  const client = getProducerValkey();
  if (client.status === "ready") return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      client.off("ready", done);
      resolve();
    };
    const timer = setTimeout(done, PRODUCER_READY_MS);
    client.once("ready", done);
  });
}

/** Entry point of the worker process. */
async function main(): Promise<void> {
  const uploads = uploadsDir();
  requireEnv(WORKER_REQUIRED_ENV, { ...process.env, EVENT_UPLOADS_DIR: uploads });
  await checkUploadsDir(uploads);
  checkEncryptionKey();
  const deps = productionDeps();
  // Jobs that waited while the worker was down run at once; they need the producer client for their Kv locks.
  await waitForProducer();
  const stop = await startWorkers(deps, getValkey());
  const stopFeed = startFeed(deps);

  const jobs = registeredJobs();
  const queues = [...new Set(jobs.map((job) => job.queue))];
  const consumers = registeredFeedConsumers().map((c) => c.name);
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
    await stopFeed();
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
