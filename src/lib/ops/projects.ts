import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { project, projectMember } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema, type AccessRole, type ProjectRow } from "./access";
import type { Actor } from "./actor";
import { insertBoard } from "./boards";
import { ConflictError, isUniqueViolation } from "./errors";
import { fieldsOf, type CustomFieldRow } from "./fields";
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
  /** The project's custom fields in order, so agents learn the keys. */
  fields: Omit<CustomFieldRow, "projectId">[];
}

/** Inserts a project owned by `actor` and logs it; the caller adds the boards. `deadline` is only set by event requests. */
export async function insertProject(tx: Tx, actor: Actor, input: z.output<typeof createProjectInput>, deadline: Date | null = null): Promise<ProjectRow> {
  const [row] = await tx.insert(project).values({ id: newId(), ...input, deadline }).returning();
  await tx.insert(projectMember).values({ projectId: row.id, userId: actor.userId, role: "owner" });
  await logChange(tx, actor, { projectId: row.id, entity: "project", entityId: row.id, field: "created", newValue: row.name });
  return row;
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
      const row = await insertProject(tx, actor, input);
      await insertBoard(tx, row.id, { slug: "development", name: "Development" }, 0);
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Project slug ${input.slug} is taken.`);
    throw error;
  }
}

/** Which projects {@link listProjects} returns by archive state. */
export const archivedFilter = z.enum(["exclude", "include", "only"]);

/**
 * Lists the projects the actor belongs to (every project for admins), by name.
 * `archived` leaves archived projects out (`exclude`, the default), adds them or returns only them.
 */
export async function listProjects(
  db: Executor,
  actor: Actor,
  opts: { archived?: z.infer<typeof archivedFilter> } = {},
): Promise<ProjectListItem[]> {
  const archived = opts.archived ?? "exclude";
  const where = archived === "exclude" ? isNull(project.archivedAt) : archived === "only" ? isNotNull(project.archivedAt) : undefined;
  const membership = and(eq(projectMember.projectId, project.id), eq(projectMember.userId, actor.userId));
  const base = db.select({ project, role: projectMember.role }).from(project);
  const rows = actor.isAdmin
    ? await base.leftJoin(projectMember, membership).where(where).orderBy(asc(project.name))
    : await base.innerJoin(projectMember, membership).where(where).orderBy(asc(project.name));
  return rows.map((r) => ({ ...r.project, role: actor.isAdmin ? "admin" : (r.role as AccessRole) }));
}

/** Returns a project the actor can see, with their role and its boards. */
export async function getProject(db: Executor, actor: Actor, slug: string): Promise<ProjectDetail> {
  const found = await projectAccess(db, actor, slug, "viewer");
  const fields = (await fieldsOf(db, found.project.id)).map((f) => ({
    id: f.id,
    key: f.key,
    name: f.name,
    type: f.type,
    options: f.options,
    sortOrder: f.sortOrder,
    createdAt: f.createdAt,
  }));
  return { ...found, boards: await loadBoards(db, found.project.id), fields };
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

/** Deletes a project and everything in it, archived or not. Owner only. */
export async function deleteProject(db: Db, actor: Actor, slug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project: current } = await projectAccess(tx, actor, slug, "owner", { allowArchived: true });
    await tx.delete(project).where(eq(project.id, current.id));
  });
}
