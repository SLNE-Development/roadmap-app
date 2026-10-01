import { sql } from "drizzle-orm";
import { feedSeen } from "@/db/schema";
import { QUEUE } from "@/lib/queue";
import { registerJob, registerRepeatable } from "./jobs";

registerJob(QUEUE.maintenance, "feed-prune", async (_data, deps) => {
  await deps.db.delete(feedSeen).where(sql`${feedSeen.seenAt} < now() - interval '15 minutes'`);
});
registerRepeatable(QUEUE.maintenance, "feed-prune", { everyMs: 5 * 60_000 });
