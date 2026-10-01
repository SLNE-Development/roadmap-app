import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { pushSubscription } from "@/db/schema";
import type { Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";

/** Input of {@link subscribePush}: the browser's subscription JSON and what to call the device. */
export const subscribePushInput = z.object({
  endpoint: z
    .string()
    .max(1000, "The push endpoint is too long.")
    .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", "The push endpoint must be an https URL."),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  label: z.string().trim().min(1).max(64),
});

/** A device as its owner sees it: never the endpoint or keys. */
export interface PushDevice {
  id: string;
  label: string;
  createdAt: Date;
  lastSuccessAt: Date | null;
}

/**
 * Saves the browser's push subscription for the actor. The same browser may sign in as someone else,
 * so an endpoint already saved moves to the actor with fresh keys and label, and under a new id with no push
 * history when the owner changes.
 *
 * @throws InvalidError if the endpoint is not an https URL or the input is malformed
 */
export async function subscribePush(db: Executor, actor: Actor, raw: z.input<typeof subscribePushInput>): Promise<{ id: string }> {
  const result = subscribePushInput.safeParse(raw);
  if (!result.success) throw new InvalidError(result.error.issues.map((i) => i.message).join(" "));
  const { endpoint, keys, label } = result.data;
  const fields = { userId: actor.userId, p256dh: keys.p256dh, auth: keys.auth, label, failures: 0 };
  // A new owner gets a new id, so pushes already queued for the old owner find no subscription.
  const sameOwner = sql`${pushSubscription.userId} = excluded.user_id`;
  const [row] = await db
    .insert(pushSubscription)
    .values({ id: newId(), endpoint, ...fields })
    .onConflictDoUpdate({
      target: pushSubscription.endpoint,
      set: {
        ...fields,
        id: sql`case when ${sameOwner} then ${pushSubscription.id} else excluded.id end`,
        lastSuccessAt: sql`case when ${sameOwner} then ${pushSubscription.lastSuccessAt} end`,
      },
    })
    .returning({ id: pushSubscription.id });
  return row;
}

/**
 * Removes one of the actor's devices.
 *
 * @throws NotFoundError if the device does not exist or belongs to someone else
 */
export async function unsubscribePush(db: Executor, actor: Actor, id: string): Promise<void> {
  const deleted = await db
    .delete(pushSubscription)
    .where(and(eq(pushSubscription.id, id), eq(pushSubscription.userId, actor.userId)))
    .returning({ id: pushSubscription.id });
  if (deleted.length === 0) throw new NotFoundError(`Unknown device ${id}.`);
}

/** Lists the actor's devices, oldest first. */
export function listDevices(db: Executor, actor: Actor): Promise<PushDevice[]> {
  return db
    .select({ id: pushSubscription.id, label: pushSubscription.label, createdAt: pushSubscription.createdAt, lastSuccessAt: pushSubscription.lastSuccessAt })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, actor.userId))
    .orderBy(asc(pushSubscription.createdAt), asc(pushSubscription.id));
}

/**
 * Queues a test push to one of the actor's devices (`push.test` on the deliver queue). Repeated clicks within the
 * same minute collapse into one job.
 *
 * @param queue the deliver queue
 * @throws NotFoundError if the device does not exist or belongs to someone else
 * @throws ConflictError if the job queue cannot be reached
 */
export async function sendTestPush(db: Executor, actor: Actor, id: string, queue: JobQueue): Promise<void> {
  const [device] = await db
    .select({ id: pushSubscription.id })
    .from(pushSubscription)
    .where(and(eq(pushSubscription.id, id), eq(pushSubscription.userId, actor.userId)))
    .limit(1);
  if (!device) throw new NotFoundError(`Unknown device ${id}.`);
  const minute = Math.floor(Date.now() / 60_000);
  try {
    await addWithTimeout(queue, "push.test", { subscriptionId: id }, { jobId: `push-test-${id}-${minute}` });
  } catch (error) {
    console.error(error);
    throw new ConflictError("Background jobs are unavailable right now, so the test push was not sent. Try again in a minute.");
  }
}
