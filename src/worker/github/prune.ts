import { lt } from "drizzle-orm";
import { githubDelivery } from "@/db/schema";
import { QUEUE } from "@/lib/queue";
import type { WorkerDeps } from "../deps";
import { registerJob, registerRepeatable } from "../jobs";

const RETENTION_MS = 30 * 86_400_000;

/** Deletes webhook deliveries received more than 30 days ago and returns how many went. */
export async function pruneDeliveries(deps: WorkerDeps): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - RETENTION_MS);
  const gone = await deps.db
    .delete(githubDelivery)
    .where(lt(githubDelivery.receivedAt, cutoff))
    .returning({ deliveryId: githubDelivery.deliveryId });
  return gone.length;
}

registerJob(QUEUE.maintenance, "github.prune-deliveries", async (_data, deps) => {
  await pruneDeliveries(deps);
});
registerRepeatable(QUEUE.maintenance, "github.prune-deliveries", { cron: "15 4 * * *", tz: "UTC" });
