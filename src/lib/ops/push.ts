import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { pushSubscription } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { addWithTimeout, type JobQueue } from "@/lib/queue";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";

/** Retries of `push.send` and `push.test`: three tries in all, the first retry after 10 s, then doubling. */
export const PUSH_RETRIES = { attempts: 3, backoffMs: 10_000 } as const;

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
  /** Whether it is the browser asking, matched by its endpoint. */
  current: boolean;
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

/** Input of {@link resubscribePush}: what the service worker posts when the browser replaced its subscription. */
export const resubscribePushInput = z.object({
  oldEndpoint: z.string().max(1000).nullish(),
  subscription: subscribePushInput.pick({ endpoint: true, keys: true }),
  label: z.string().trim().max(64).nullish(),
});

/**
 * Saves the subscription a browser replaced on its own for the actor and deletes the old one when it is the
 * actor's. Without a label the old device's label is kept, else `fallbackLabel` is used.
 *
 * @throws InvalidError if the input is malformed
 */
export async function resubscribePush(db: Db, actor: Actor, raw: unknown, fallbackLabel: string): Promise<{ id: string }> {
  const result = resubscribePushInput.safeParse(raw);
  if (!result.success) throw new InvalidError(result.error.issues.map((i) => i.message).join(" "));
  const { oldEndpoint, subscription, label } = result.data;
  return db.transaction(async (tx) => {
    const own = (endpoint: string) => and(eq(pushSubscription.endpoint, endpoint), eq(pushSubscription.userId, actor.userId));
    const [old] = oldEndpoint ? await tx.select({ label: pushSubscription.label }).from(pushSubscription).where(own(oldEndpoint)) : [];
    const saved = await subscribePush(tx, actor, { ...subscription, label: label || old?.label || fallbackLabel });
    if (oldEndpoint && old && oldEndpoint !== subscription.endpoint) await tx.delete(pushSubscription).where(own(oldEndpoint));
    return saved;
  });
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

/** The hex SHA-256 of a push endpoint; browsers send it to find their own device without sending the endpoint. */
export function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

/**
 * Lists the actor's devices, oldest first.
 *
 * @param currentHash the {@link endpointHash} of the asking browser's endpoint, if it has one, to mark its device as current
 */
export async function listDevices(db: Executor, actor: Actor, currentHash?: string | null): Promise<PushDevice[]> {
  const rows = await db
    .select({
      id: pushSubscription.id,
      label: pushSubscription.label,
      createdAt: pushSubscription.createdAt,
      lastSuccessAt: pushSubscription.lastSuccessAt,
      endpoint: pushSubscription.endpoint,
    })
    .from(pushSubscription)
    .where(eq(pushSubscription.userId, actor.userId))
    .orderBy(asc(pushSubscription.createdAt), asc(pushSubscription.id));
  return rows.map(({ endpoint, ...device }) => ({ ...device, current: !!currentHash && endpointHash(endpoint) === currentHash }));
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
    await addWithTimeout(queue, "push.test", { subscriptionId: id }, { jobId: `push-test-${id}-${minute}`, ...PUSH_RETRIES });
  } catch (error) {
    console.error(error);
    throw new ConflictError("Background jobs are unavailable right now, so the test push was not sent. Try again in a minute.");
  }
}
