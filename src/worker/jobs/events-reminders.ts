import { QUEUE } from "@/lib/queue";
import { sweepOrphanFiles } from "@/lib/ops/uploads";
import { runRequestReminders } from "@/lib/ops/request-reminders";
import { uploadsDir } from "@/lib/uploads";
import type { WorkerDeps } from "../deps";
import { registerJob, registerRepeatable } from "../jobs";

/**
 * Creates the event request reminders that are due and removes upload files that no row refers to. It only writes
 * notifications: it never posts, never changes a status or a post and never calls Discord.
 */
export async function eventsReminders(deps: WorkerDeps): Promise<void> {
  const now = deps.now();
  const { created } = await runRequestReminders(deps.db, now);
  const removed = await sweepOrphanFiles(deps.db, uploadsDir(), now);
  if (created > 0 || removed > 0) console.log(`events.reminders: ${created} notices created, ${removed} orphan files removed`);
}

registerJob(QUEUE.maintenance, "events.reminders", (_data, deps) => eventsReminders(deps));
registerRepeatable(QUEUE.maintenance, "events.reminders", { cron: "10 * * * *", tz: "UTC" });
