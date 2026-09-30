import type { WorkerDeps } from "./deps";

export const HEARTBEAT_FILE = "/tmp/worker-alive";
export const HEARTBEAT_KEY = "worker:heartbeat";

/** Records that the worker is alive: a file for the container healthcheck and a key with a 30 s TTL. */
export async function beat(
  deps: WorkerDeps,
  writeFile: (path: string, data: string) => Promise<void>,
): Promise<void> {
  const iso = deps.now().toISOString();
  await writeFile(HEARTBEAT_FILE, iso);
  await deps.kv.set(HEARTBEAT_KEY, iso, 30);
}
