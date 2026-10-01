import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { progressUpdate, project, system, task, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { InvalidError } from "./errors";
import { logChange } from "./log";
import { findSystem, systemAccess } from "./lookup";
import { notifyMentions, resolveMentionsIn } from "./mentions";
import { actorLabel } from "./notifications";

/** Longest update summary and next step. */
const SUMMARY_MAX = 5000;
const NEXT_STEP_MAX = 2000;

/** Input of {@link postUpdate}. */
export const postUpdateInput = z.object({
  summary: z.string().trim().min(1).max(SUMMARY_MAX),
  nextStep: z.string().trim().max(NEXT_STEP_MAX).optional(),
  taskId: z.number().int().optional(),
  commit: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[0-9a-f]{7,40}$/, "commit must be a 7 to 40 character hex hash")
    .optional(),
});

/** Filters of {@link listUpdates}. */
export const listUpdatesInput = z.object({
  system: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(50),
  /** A user id: only that person's updates, agent updates made on their behalf included. */
  person: z.string().optional(),
  /** `only` keeps updates posted by agents, `exclude` drops them. */
  agents: z.enum(["only", "exclude"]).optional(),
  /** Id cursor: only updates after this one in the newest-first order, for "Load older". */
  before: z.string().min(1).optional(),
});

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
    const summary = await resolveMentionsIn(tx, project.id, input.summary, SUMMARY_MAX);
    const nextStep = input.nextStep ? await resolveMentionsIn(tx, project.id, input.nextStep, NEXT_STEP_MAX) : null;
    await tx.insert(progressUpdate).values({
      id,
      systemId: parent.id,
      taskId: input.taskId ?? null,
      summary,
      nextStep,
      commitHash: input.commit ?? null,
      authorUserId: actor.userId,
      agent: actor.agent ?? null,
    });
    await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "update", entityId: id, field: "posted", newValue: summary });
    await notifyMentions(tx, actor, {
      projectId: project.id,
      before: null,
      after: nextStep ? `${summary}\n${nextStep}` : summary,
      title: `${actorLabel(actor.name, actor.agent)} mentioned you in an update on ${parent.title}`,
      href: `/p/${project.slug}/systems/${parent.slug}`,
      source: `update:${id}`,
    });
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
  const systemId = filter.system ? (await findSystem(db, project.id, filter.system)).id : null;
  return updatesOf(db, systemId, project.id, filter.limit, filter);
}

/** {@link listUpdates} for a project and system the caller already resolved; performs no access check. */
export async function updatesOf(
  db: Executor,
  systemId: string | null,
  projectId: string,
  limit: number,
  filter: Pick<z.infer<typeof listUpdatesInput>, "person" | "agents" | "before"> = {},
): Promise<UpdateItem[]> {
  const conditions: SQL[] = [systemId ? eq(progressUpdate.systemId, systemId) : eq(system.projectId, projectId)];
  if (filter.person) conditions.push(eq(progressUpdate.authorUserId, filter.person));
  if (filter.agents) conditions.push(filter.agents === "only" ? isNotNull(progressUpdate.agent) : isNull(progressUpdate.agent));
  // Keyset on (created_at, id), read from the cursor row so microsecond timestamps compare exactly.
  if (filter.before) {
    conditions.push(
      sql`(${progressUpdate.createdAt}, ${progressUpdate.id}) < (select p.created_at, p.id from progress_update p where p.id = ${filter.before})`,
    );
  }
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
      repoUrl: project.repoUrl,
      authorName: user.name,
      agent: progressUpdate.agent,
      createdAt: progressUpdate.createdAt,
    })
    .from(progressUpdate)
    .innerJoin(system, eq(system.id, progressUpdate.systemId))
    .innerJoin(project, eq(project.id, system.projectId))
    .leftJoin(task, eq(task.id, progressUpdate.taskId))
    .leftJoin(user, eq(user.id, progressUpdate.authorUserId))
    .where(and(...conditions))
    .orderBy(desc(progressUpdate.createdAt), desc(progressUpdate.id))
    .limit(limit);
  return rows.map(({ authorName, agent, repoUrl, ...r }) => ({
    ...r,
    commitUrl: commitUrl(repoUrl, r.commitHash),
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
