import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { requireActor } from "@/lib/auth/actor";
import type { Actor } from "@/lib/ops/actor";
import { NotFoundError } from "@/lib/ops/errors";

/**
 * Loads page data as the signed-in actor. Unknown or invisible entities render
 * the 404 page; other errors propagate to the error boundary.
 */
export async function pageData<T>(fn: (db: Db, actor: Actor) => Promise<T>): Promise<T> {
  const actor = await requireActor();
  try {
    return await fn(getDb(), actor);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** Returns a copy of `row` with `createdAt` as an ISO string, for client components. */
export function toIso<T extends { createdAt: Date }>(row: T): Omit<T, "createdAt"> & { createdAt: string } {
  return { ...row, createdAt: row.createdAt.toISOString() };
}
