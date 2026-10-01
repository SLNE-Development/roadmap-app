import { and, eq } from "drizzle-orm";
import { release } from "@/db/schema";
import type { Executor } from "@/db/types";
import { NotFoundError } from "./errors";

/** A release row. */
export type ReleaseRow = typeof release.$inferSelect;

/**
 * Returns the release with `slug` in the project, optionally locking its row
 * until the surrounding transaction ends.
 *
 * @throws NotFoundError if there is none
 */
export async function findRelease(tx: Executor, projectId: string, slug: string, lock = false): Promise<ReleaseRow> {
  const query = tx
    .select()
    .from(release)
    .where(and(eq(release.projectId, projectId), eq(release.slug, slug)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new NotFoundError(`Unknown release ${slug}.`);
  return row;
}
