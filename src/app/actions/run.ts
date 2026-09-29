import "server-only";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { sessionActor } from "@/lib/auth/actor";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";

/** Result of a server action: a value, or an error message to show. */
export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Runs `fn` as the signed-in actor. Server actions are reachable without the
 * route guard, so this checks the session itself, revalidates every page on
 * success, and turns thrown errors into a message.
 */
export async function runAction<T>(fn: (db: Db, actor: Actor) => Promise<T>): Promise<ActionResult<T>> {
  const actor = await sessionActor();
  if (!actor) return { ok: false, error: "Your session has ended. Sign in again." };
  try {
    const value = await fn(getDb(), actor);
    revalidatePath("/", "layout");
    return { ok: true, value };
  } catch (error) {
    if (statusOf(error) === 500) console.error(error);
    return { ok: false, error: messageOf(error) };
  }
}
