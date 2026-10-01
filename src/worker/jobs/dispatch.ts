import { and, asc, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import { notification, pushSubscription } from "@/db/schema";
import type { Executor } from "@/db/types";
import { activeKey, pushDecision, type NotifyRules } from "@/lib/notify-rules-schema";
import { canReceive } from "@/lib/ops/notifications";
import { readNotifyRules } from "@/lib/ops/notify-rules";
import { pushConfig } from "@/lib/push-config";
import { QUEUE } from "@/lib/queue";
import type { WorkerDeps } from "../deps";
import { registerJob, registerRepeatable } from "../jobs";

/** Pending rows one run handles at most. */
const BATCH = 200;
/** How long a notification may wait for its push. */
const WINDOW_MS = 86_400_000;

/** What one run did with the rows it looked at. */
export interface DispatchResult {
  sent: number;
  skipped: number;
  /** Rows it saw held by quiet hours; once a user is held, their further rows are not selected. */
  later: number;
}

/** A user's push state, read once per run. */
interface Recipient {
  rules: NotifyRules;
  isActive: boolean;
  subscriptionIds: string[];
}

async function setStatus(tx: Executor, ids: string[], pushStatus: "sent" | "skipped"): Promise<void> {
  if (ids.length > 0) await tx.update(notification).set({ pushStatus }).where(inArray(notification.id, ids));
}

/**
 * Hands pending notifications of the last 24 h to `push.send`, settling at most 200 per run, locking them with
 * `skip locked` so overlapping runs never take the same row. Rows held by quiet hours do not count toward the 200. Each row is skipped when push is off, when the
 * recipient can no longer receive it, or when their rules say so; it stays pending during quiet hours. Older
 * pending rows are skipped. Jobs are queued inside the transaction, so a failed enqueue leaves the rows pending;
 * the job ids make the retry queue nothing twice.
 *
 * @throws Error if the key-value store or the queue fails, so the run is retried
 */
export async function dispatchPushes(deps: WorkerDeps): Promise<DispatchResult> {
  const now = deps.now();
  const since = new Date(now.getTime() - WINDOW_MS);
  const config = pushConfig();
  const queue = deps.queue("deliver");
  return deps.db.transaction(async (tx) => {
    await tx
      .update(notification)
      .set({ pushStatus: "skipped" })
      .where(and(eq(notification.pushStatus, "pending"), lt(notification.createdAt, since)));
    const sent: string[] = [];
    const skipped: string[] = [];
    let later = 0;
    // Quiet hours hold every row of a user, so later pages leave those users out and their rows never fill a batch.
    const laterUsers = new Set<string>();
    const receives = new Map<string, boolean>();
    const recipients = new Map<string, Recipient>();
    while (sent.length + skipped.length < BATCH) {
      const conditions = [eq(notification.pushStatus, "pending"), gte(notification.createdAt, since)];
      if (laterUsers.size > 0) conditions.push(notInArray(notification.userId, [...laterUsers]));
      const rows = await tx
        .select({ id: notification.id, userId: notification.userId, projectId: notification.projectId, kind: notification.kind })
        .from(notification)
        .where(and(...conditions))
        .orderBy(asc(notification.createdAt), asc(notification.id))
        .limit(BATCH - sent.length - skipped.length)
        .for("update", { skipLocked: true });
      if (rows.length === 0) break;
      const pageSent: string[] = [];
      const pageSkipped: string[] = [];
      for (const row of rows) {
        if (laterUsers.has(row.userId)) {
          later++;
          continue;
        }
        if (!config) {
          pageSkipped.push(row.id);
          continue;
        }
        const memberKey = `${row.userId}/${row.projectId}`;
        let receive = receives.get(memberKey);
        if (receive === undefined) {
          receive = await canReceive(tx, row.userId, row.projectId);
          receives.set(memberKey, receive);
        }
        if (!receive) {
          pageSkipped.push(row.id);
          continue;
        }
        let recipient = recipients.get(row.userId);
        if (!recipient) {
          const subscriptions = await tx.select({ id: pushSubscription.id }).from(pushSubscription).where(eq(pushSubscription.userId, row.userId));
          recipient = {
            rules: await readNotifyRules(tx, row.userId),
            isActive: (await deps.kv.get(activeKey(row.userId))) !== null,
            subscriptionIds: subscriptions.map((s) => s.id),
          };
          recipients.set(row.userId, recipient);
        }
        const decision = pushDecision(recipient.rules, row.kind, now, recipient.isActive);
        if (decision === "later") {
          later++;
          laterUsers.add(row.userId);
        } else if (decision === "skip" || recipient.subscriptionIds.length === 0) {
          pageSkipped.push(row.id);
        } else {
          // Queued before the commit: a failed commit re-queues under the same job ids (at least once).
          for (const subscriptionId of recipient.subscriptionIds) {
            await queue.add("push.send", { notificationId: row.id, subscriptionId }, { jobId: `push-${row.id}-${subscriptionId}` });
          }
          pageSent.push(row.id);
        }
      }
      // Settled rows leave `pending` now, so the next page cannot select them again.
      await setStatus(tx, pageSent, "sent");
      await setStatus(tx, pageSkipped, "skipped");
      sent.push(...pageSent);
      skipped.push(...pageSkipped);
    }
    return { sent: sent.length, skipped: skipped.length, later };
  });
}

registerJob(QUEUE.deliver, "notifications.dispatch", async (_data, deps) => {
  await dispatchPushes(deps);
});
registerRepeatable(QUEUE.deliver, "notifications.dispatch", { everyMs: 5000 });
