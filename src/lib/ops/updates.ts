import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { progressUpdate, system, task, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { InvalidError } from "./errors";
import { logChange } from "./log";
import { findSystem, systemAccess } from "./lookup";

/** Input of {@link postUpdate}. */
export const postUpdateInput = z.object({
  summary: z.string().trim().min(1).max(5000),
  nextStep: z.string().trim().max(2000).optional(),
  taskId: z.number().int().optional(),
  commit: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{7,40}$/, "commit must be a 7 to 40 character hex hash")
    .optional(),
});

/** Filters of {@link listUpdates}. */
export const listUpdatesInput = z.object({ system: z.string().optional(), limit: z.number().int().min(1).max(500).default(50) });

/** A progress update as shown in feeds and on systems, with its author split into person and agent. */
export interface UpdateItem extends AuthorFields {
  id: string;
  systemSlug: string;
  systemTitle: string;
  taskId: number | null;
  taskTitle: string | null;
  summary: string;
  nextStep: string | null;
  commitHash: string | null;
  commitUrl: string | null;
  /** Whether an agent posted it; the same as `agent !== null`. */
  isAgent: boolean;
  createdAt: Date;
}

/** Returns the web URL of a commit in the project's repository, or `null` without both parts. */
export function commitUrl(repoUrl: string | null, hash: string | null): string | null {
  return repoUrl && hash ? `${repoUrl.replace(/\/+$/, "")}/commit/${hash}` : null;
}

/**
 * Posts a progress update on a system. Editor or higher.
 *
 * @throws InvalidError if the task belongs to another system
 */
export async function postUpdate(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof postUpdateInput>,
): Promise<{ id: string; commitUrl: string | null }> {
  const input = postUpdateInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project, system: parent } = await systemAccess(tx, actor, projectSlug, systemSlug, "editor");
    if (input.taskId !== undefined) {
      const rows = await tx.select({ id: task.id }).from(task).where(and(eq(task.id, input.taskId), eq(task.systemId, parent.id)));
      if (rows.length === 0) throw new InvalidError(`Task ${input.taskId} does not belong to system ${systemSlug}.`);
    }
    const id = newId();
    await tx.insert(progressUpdate).values({
      id,
      systemId: parent.id,
      taskId: input.taskId ?? null,
      summary: input.summary,
      nextStep: input.nextStep || null,
      commitHash: input.commit ?? null,
      authorUserId: actor.userId,
      agent: actor.agent ?? null,
    });
    await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "update", entityId: id, field: "posted", newValue: input.summary });
    return { id, commitUrl: commitUrl(project.repoUrl, input.commit ?? null) };
  });
}

/** Lists progress updates of the project, or of one system, newest first. */
export async function listUpdates(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof listUpdatesInput> = {},
): Promise<UpdateItem[]> {
  const filter = listUpdatesInput.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const where = filter.system
    ? eq(progressUpdate.systemId, (await findSystem(db, project.id, filter.system)).id)
    : eq(system.projectId, project.id);
  const rows = await db
    .select({
      id: progressUpdate.id,
      systemSlug: system.slug,
      systemTitle: system.title,
      taskId: progressUpdate.taskId,
      taskTitle: task.title,
      summary: progressUpdate.summary,
      nextStep: progressUpdate.nextStep,
      commitHash: progressUpdate.commitHash,
      authorName: user.name,
      agent: progressUpdate.agent,
      createdAt: progressUpdate.createdAt,
    })
    .from(progressUpdate)
    .innerJoin(system, eq(system.id, progressUpdate.systemId))
    .leftJoin(task, eq(task.id, progressUpdate.taskId))
    .leftJoin(user, eq(user.id, progressUpdate.authorUserId))
    .where(where)
    .orderBy(desc(progressUpdate.createdAt), desc(progressUpdate.id))
    .limit(filter.limit);
  return rows.map(({ authorName, agent, ...r }) => ({
    ...r,
    commitUrl: commitUrl(project.repoUrl, r.commitHash),
    ...authorFields(authorName, agent),
    isAgent: agent !== null,
  }));
}

/** Returns the newest update of every system in the project that has one, keyed by system id. */
export async function latestUpdates(db: Executor, projectId: string): Promise<Map<string, { summary: string; createdAt: Date }>> {
  const rows = await db
    .selectDistinctOn([progressUpdate.systemId], {
      systemId: progressUpdate.systemId,
      summary: progressUpdate.summary,
      createdAt: progressUpdate.createdAt,
    })
    .from(progressUpdate)
    .innerJoin(system, eq(system.id, progressUpdate.systemId))
    .where(eq(system.projectId, projectId))
    .orderBy(progressUpdate.systemId, desc(progressUpdate.createdAt), desc(progressUpdate.id));
  return new Map(rows.map((r) => [r.systemId, { summary: r.summary, createdAt: r.createdAt }]));
}
