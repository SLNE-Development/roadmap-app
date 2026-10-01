import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { release } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema, type AccessRole, type ProjectRow } from "./access";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError } from "./errors";
import { logChange } from "./log";
import type { SystemRow } from "./lookup";

/** A release row. */
export type ReleaseRow = typeof release.$inferSelect;

/** Input of {@link createRelease}. */
export const createReleaseInput = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  targetDate: z.iso.date().nullable().optional(),
});

/** Input of {@link updateRelease}; omitted fields stay unchanged. */
export const updateReleaseInput = z.object({
  slug: slugSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  targetDate: z.iso.date().nullable().optional(),
});

/** Whether the role may manage owner-only parts of a release. */
function isOwnerRole(role: AccessRole): boolean {
  return role === "owner" || role === "admin";
}

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

/**
 * Creates a planned release. Editor or higher.
 *
 * @throws ConflictError if the slug is taken in this project
 */
export async function createRelease(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createReleaseInput>): Promise<ReleaseRow> {
  const input = createReleaseInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project } = await projectAccess(tx, actor, projectSlug, "editor");
      const [row] = await tx
        .insert(release)
        .values({ id: newId(), projectId: project.id, slug: input.slug, name: input.name, targetDate: input.targetDate ?? null })
        .returning();
      await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: row.id, field: "created", newValue: row.name });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Release slug ${input.slug} is taken in this project.`);
    throw error;
  }
}

/**
 * Changes a release's slug, name or target date, logging each change. Editor or
 * higher; renaming or re-dating a frozen release needs an owner and a shipped one is fixed.
 *
 * @throws ForbiddenError if a frozen release is changed by a non-owner
 * @throws ConflictError if the release is shipped or the slug is taken
 */
export async function updateRelease(
  db: Db,
  actor: Actor,
  projectSlug: string,
  releaseSlug: string,
  raw: z.input<typeof updateReleaseInput>,
): Promise<ReleaseRow> {
  const patch = updateReleaseInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project, role } = await projectAccess(tx, actor, projectSlug, "editor");
      const current = await findRelease(tx, project.id, releaseSlug, true);
      const changes: Partial<Pick<ReleaseRow, "slug" | "name" | "targetDate">> = {};
      for (const field of ["slug", "name", "targetDate"] as const) {
        const next = patch[field];
        if (next === undefined || next === current[field]) continue;
        Object.assign(changes, { [field]: next });
      }
      if (Object.keys(changes).length === 0) return current;
      if (current.status === "shipped") throw new ConflictError(`${current.name} is shipped; it can no longer change.`);
      if (current.status === "frozen" && !isOwnerRole(role)) {
        throw new ForbiddenError(`${current.name} is frozen; only an owner can change its name or target date.`);
      }
      const [row] = await tx.update(release).set(changes).where(eq(release.id, current.id)).returning();
      for (const field of Object.keys(changes) as (keyof typeof changes)[]) {
        await logChange(tx, actor, {
          projectId: project.id,
          entity: "release",
          entityId: current.id,
          field,
          oldValue: current[field],
          newValue: row[field],
        });
      }
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Release slug ${patch.slug} is taken in this project.`);
    throw error;
  }
}

/**
 * Freezes a planned release: from then on only owners change its scope. Owner only.
 *
 * @throws ConflictError if the release is not planned
 */
export async function freezeRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string): Promise<ReleaseRow> {
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    if (current.status !== "planned") throw new ConflictError(`${current.name} is ${current.status}; only a planned release can be frozen.`);
    const [row] = await tx.update(release).set({ status: "frozen", frozenAt: new Date() }).where(eq(release.id, current.id)).returning();
    await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: current.id, field: "status", oldValue: "planned", newValue: "frozen" });
    return row;
  });
}

/**
 * Returns a frozen release to planned, so editors can change its scope again. Owner only.
 *
 * @throws ConflictError if the release is not frozen
 */
export async function unfreezeRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string): Promise<ReleaseRow> {
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    if (current.status !== "frozen") throw new ConflictError(`${current.name} is ${current.status}; only a frozen release can be unfrozen.`);
    const [row] = await tx.update(release).set({ status: "planned", frozenAt: null }).where(eq(release.id, current.id)).returning();
    await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: current.id, field: "status", oldValue: "frozen", newValue: "planned" });
    return row;
  });
}

/**
 * Deletes a planned release; its systems become unassigned. Owner only.
 *
 * @throws ConflictError if the release is frozen or shipped
 */
export async function deleteRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    if (current.status !== "planned") throw new ConflictError(`${current.name} is ${current.status}; only a planned release can be deleted.`);
    await tx.delete(release).where(eq(release.id, current.id));
    await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: current.id, field: "deleted", oldValue: current.name });
  });
}

/** The outcome of {@link assignRelease}: the new release id and the names to log. */
export interface ReleaseAssignment {
  releaseId: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Checks and resolves moving `system` into the release `slug` (`null` removes it
 * from its release), locking the previous and the target release rows so a
 * freeze and an assignment serialise. Returns `null` when nothing changes.
 *
 * @throws NotFoundError if the release is unknown
 * @throws ConflictError if the previous or target release is shipped
 * @throws ForbiddenError if either is frozen and the actor is no owner
 */
export async function assignRelease(
  tx: Executor,
  actor: Actor,
  project: ProjectRow,
  system: SystemRow,
  slug: string | null,
): Promise<ReleaseAssignment | null> {
  const target = slug === null ? null : await findRelease(tx, project.id, slug);
  if ((target?.id ?? null) === system.releaseId) return null;
  const { role } = await projectAccess(tx, actor, project.slug, "editor");
  // Lock in id order so two assignments crossing the same releases never deadlock.
  const ids = [...new Set([system.releaseId, target?.id].filter((id): id is string => Boolean(id)))].sort();
  const locked = new Map<string, ReleaseRow>();
  for (const id of ids) {
    const [row] = await tx.select().from(release).where(eq(release.id, id)).for("update");
    if (row) locked.set(id, row);
  }
  const previous = system.releaseId ? locked.get(system.releaseId) : undefined;
  const next = target ? locked.get(target.id) : undefined;
  if (target && !next) throw new NotFoundError(`Unknown release ${target.slug}.`);
  for (const row of [previous, next]) {
    if (!row) continue;
    if (row.status === "shipped") throw new ConflictError(`${row.name} is shipped; its scope can no longer change.`);
    if (row.status === "frozen" && !isOwnerRole(role)) throw new ForbiddenError(`${row.name} is frozen; only an owner can change its scope.`);
  }
  return { releaseId: next?.id ?? null, from: previous?.name ?? null, to: next?.name ?? null };
}
