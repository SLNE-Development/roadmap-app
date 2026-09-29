import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { project, projectMember } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema, type AccessRole, type ProjectRow } from "./access";
import type { Actor } from "./actor";
import { insertBoard } from "./boards";
import { ConflictError, isUniqueViolation } from "./errors";
import { logChange } from "./log";
import { loadBoards, type BoardWithColumns } from "./lookup";

/** An http(s) URL, or null. */
const repoUrlSchema = z.url({ protocol: /^https?$/ }).nullable();

/** Input of {@link createProject}. */
export const createProjectInput = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).default(""),
  repoUrl: repoUrlSchema.default(null),
});

/** Input of {@link updateProject}; omitted fields stay unchanged. */
export const updateProjectInput = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  repoUrl: repoUrlSchema.optional(),
});

/** A project in the actor's list, with their effective role. */
export interface ProjectListItem extends ProjectRow {
  role: AccessRole;
}

/** A project with the actor's role and its boards. */
export interface ProjectDetail {
  project: ProjectRow;
  role: AccessRole;
  boards: BoardWithColumns[];
}

/**
 * Creates a project owned by the actor, with a Development board.
 *
 * @throws ConflictError if the slug is taken
 */
export async function createProject(db: Db, actor: Actor, raw: z.input<typeof createProjectInput>): Promise<ProjectRow> {
  const input = createProjectInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(project).values({ id: newId(), ...input }).returning();
      await tx.insert(projectMember).values({ projectId: row.id, userId: actor.userId, role: "owner" });
      await insertBoard(tx, row.id, { slug: "development", name: "Development" }, 0);
      await logChange(tx, actor, { projectId: row.id, entity: "project", entityId: row.id, field: "created", newValue: row.name });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Project slug ${input.slug} is taken.`);
    throw error;
  }
}

/** Lists the projects the actor belongs to (every project for admins), by name. */
export async function listProjects(db: Executor, actor: Actor): Promise<ProjectListItem[]> {
  const membership = and(eq(projectMember.projectId, project.id), eq(projectMember.userId, actor.userId));
  const base = db.select({ project, role: projectMember.role }).from(project);
  const rows = actor.isAdmin
    ? await base.leftJoin(projectMember, membership).orderBy(asc(project.name))
    : await base.innerJoin(projectMember, membership).orderBy(asc(project.name));
  return rows.map((r) => ({ ...r.project, role: actor.isAdmin ? "admin" : (r.role as AccessRole) }));
}

/** Returns a project the actor can see, with their role and its boards. */
export async function getProject(db: Executor, actor: Actor, slug: string): Promise<ProjectDetail> {
  const found = await projectAccess(db, actor, slug, "viewer");
  return { ...found, boards: await loadBoards(db, found.project.id) };
}

/** Changes name, description or repository URL, logging each changed field. Owner only. */
export async function updateProject(db: Db, actor: Actor, slug: string, raw: z.input<typeof updateProjectInput>): Promise<ProjectRow> {
  const patch = updateProjectInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project: current } = await projectAccess(tx, actor, slug, "owner");
    const changes: Partial<ProjectRow> = {};
    for (const field of ["name", "description", "repoUrl"] as const) {
      const next = patch[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(changes, { [field]: next });
      await logChange(tx, actor, {
        projectId: current.id,
        entity: "project",
        entityId: current.id,
        field,
        oldValue: current[field],
        newValue: next,
      });
    }
    if (Object.keys(changes).length === 0) return current;
    const [row] = await tx.update(project).set(changes).where(eq(project.id, current.id)).returning();
    return row;
  });
}

/** Deletes a project and everything in it. Owner only. */
export async function deleteProject(db: Db, actor: Actor, slug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project: current } = await projectAccess(tx, actor, slug, "owner");
    await tx.delete(project).where(eq(project.id, current.id));
  });
}
