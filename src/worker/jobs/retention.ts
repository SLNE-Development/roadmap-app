import { inArray, lt } from "drizzle-orm";
import { agentCall, agentRun, authEvent } from "@/db/schema";
import { QUEUE } from "@/lib/queue";
import type { WorkerDeps } from "../deps";
import { registerJob, registerRepeatable } from "../jobs";

const DAY_MS = 86_400_000;
const BATCH = 5_000;

/** Deletes agent telemetry past its retention: calls and runs after 30 days, auth events after 90. */
export async function pruneTelemetry(deps: WorkerDeps): Promise<{ calls: number; runs: number; events: number }> {
  const { db } = deps;
  const cutoff = new Date(deps.now().getTime() - 30 * DAY_MS);

  let calls = 0;
  for (;;) {
    const gone = await db
      .delete(agentCall)
      .where(
        inArray(
          agentCall.id,
          db.select({ id: agentCall.id }).from(agentCall).where(lt(agentCall.at, cutoff)).limit(BATCH),
        ),
      )
      .returning({ id: agentCall.id });
    calls += gone.length;
    if (gone.length < BATCH) break;
  }

  const runs = (await db.delete(agentRun).where(lt(agentRun.lastCallAt, cutoff)).returning({ id: agentRun.id })).length;

  const eventCutoff = new Date(deps.now().getTime() - 90 * DAY_MS);
  let events = 0;
  for (;;) {
    const gone = await db
      .delete(authEvent)
      .where(
        inArray(
          authEvent.id,
          db.select({ id: authEvent.id }).from(authEvent).where(lt(authEvent.at, eventCutoff)).limit(BATCH),
        ),
      )
      .returning({ id: authEvent.id });
    events += gone.length;
    if (gone.length < BATCH) break;
  }

  return { calls, runs, events };
}

registerJob(QUEUE.maintenance, "prune-telemetry", async (_data, deps) => {
  await pruneTelemetry(deps);
});
registerRepeatable(QUEUE.maintenance, "prune-telemetry", { cron: "30 3 * * *", tz: "UTC" });
