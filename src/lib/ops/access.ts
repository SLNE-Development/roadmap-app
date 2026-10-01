import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { project, projectMember, type ProjectRole } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";

/** A URL-safe identifier: lowercase letters and digits separated by single dashes, at most 64 characters. */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "use lowercase letters, digits and single dashes");

/** A project row. */
export type ProjectRow = typeof project.$inferSelect;

/** The effective role of an actor in a project; admins rank above owners. */
export type AccessRole = ProjectRole | "admin";

/** A project the actor may access, with their effective role. */
export interface ProjectAccess {
  project: ProjectRow;
  role: AccessRole;
}

/** Options of {@link projectAccess} and {@link projectAccessById}. */
export interface AccessOptions {
  /** Lets a write pass on an archived project; only archiving, restoring and deleting it use this. */
  allowArchived?: boolean;
}

/** Rank of each role; a higher rank includes every right of a lower one. */
const RANK: Record<AccessRole, number> = { viewer: 1, editor: 2, owner: 3, admin: 4 };

/** Loads the project matching `where` with the actor's membership role and checks `need` and, for writes, that it is not archived. */
async function access(db: Executor, actor: Actor, where: SQL, label: string, need: ProjectRole, opts?: AccessOptions): Promise<ProjectAccess> {
  const [row] = await db
    .select({ project, role: projectMember.role })
    .from(project)
    .leftJoin(projectMember, and(eq(projectMember.projectId, project.id), eq(projectMember.userId, actor.userId)))
    .where(where)
    .limit(1);
  if (!row || (!row.role && !actor.isAdmin)) throw new NotFoundError(`Unknown project ${label}.`);
  const role: AccessRole = actor.isAdmin ? "admin" : (row.role as ProjectRole);
  if (RANK[role] < RANK[need]) {
    throw new ForbiddenError(`This needs the ${need} role in project ${row.project.slug}; you are ${role}.`);
  }
  if (row.project.archivedAt && need !== "viewer" && !opts?.allowArchived) {
    throw new ConflictError(`Project ${row.project.slug} is archived; an owner can restore it.`);
  }
  return { project: row.project, role };
}

/**
 * Returns the project with `slug` if the actor may act in it with at least `need`.
 *
 * @throws NotFoundError if it does not exist or the actor is not a member (and not an admin)
 * @throws ForbiddenError if the actor's role is below `need`
 * @throws ConflictError if `need` is above viewer and the project is archived, unless `opts.allowArchived`
 */
export function projectAccess(db: Executor, actor: Actor, slug: string, need: ProjectRole, opts?: AccessOptions): Promise<ProjectAccess> {
  return access(db, actor, eq(project.slug, slug), slug, need, opts);
}

/** Same as {@link projectAccess}, looking the project up by id. */
export function projectAccessById(db: Executor, actor: Actor, projectId: string, need: ProjectRole, opts?: AccessOptions): Promise<ProjectAccess> {
  return access(db, actor, eq(project.id, projectId), projectId, need, opts);
}
