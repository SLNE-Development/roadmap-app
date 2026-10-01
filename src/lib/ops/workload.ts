import { and, eq, inArray, isNull } from "drizzle-orm";
import { allowedAccount, boardColumn, project, projectMember, system, task, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { ESTIMATE_POINTS } from "@/lib/rollup";
import { overloaded } from "@/lib/workload";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

/** One teammate's load across the projects the actor shares with them. */
export interface WorkloadRow {
  userId: string;
  name: string;
  image: string | null;
  systemsOwned: number;
  systemsBlocked: number;
  tasksDoing: number;
  tasksBlocked: number;
  openPoints: number;
  projects: { slug: string; name: string; systems: number; tasksDoing: number }[];
}

/** The non-archived projects where the actor is an active member (an admin who is not a member gets none). */
async function scopeProjects(db: Executor, actor: Actor) {
  return db
    .select({ id: project.id, slug: project.slug, name: project.name })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .innerJoin(project, eq(project.id, projectMember.projectId))
    .where(and(eq(projectMember.userId, actor.userId), isNull(project.archivedAt)))
    .orderBy(project.name);
}

/** Lists the projects {@link teamWorkload} can be narrowed to: the ones the actor is an active member of. */
export async function workloadProjects(db: Executor, actor: Actor): Promise<{ slug: string; name: string }[]> {
  return (await scopeProjects(db, actor)).map((p) => ({ slug: p.slug, name: p.name }));
}

/**
 * Lists the workload of every active member of the projects where the actor is
 * an active member (an admin who is not a member sees nothing of a project).
 * Only work inside those projects counts, archived projects and systems are
 * left out, and a removed member or account shows nothing. Sorted by open
 * points, then tasks doing, then name.
 *
 * @param opts.project limit to this project slug
 * @throws NotFoundError if `opts.project` is not a project the actor is a member of
 */
export async function teamWorkload(db: Executor, actor: Actor, opts: { project?: string }): Promise<WorkloadRow[]> {
  const scope = await scopeProjects(db, actor);
  const projects = opts.project ? scope.filter((p) => p.slug === opts.project) : scope;
  if (opts.project && projects.length === 0) throw new NotFoundError(`Project ${opts.project} not found.`);
  if (projects.length === 0) return [];
  const projectIds = projects.map((p) => p.id);
  const byId = new Map(projects.map((p) => [p.id, p]));

  const [members, systems, tasks] = await Promise.all([
    db
      .select({ userId: user.id, name: user.name, image: user.image, projectId: projectMember.projectId })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
      .where(inArray(projectMember.projectId, projectIds)),
    db
      .select({ owner: system.ownerUserId, projectId: system.projectId, category: boardColumn.category })
      .from(system)
      .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
      .where(and(inArray(system.projectId, projectIds), isNull(system.archivedAt))),
    db
      .select({ owner: task.ownerUserId, projectId: system.projectId, state: task.state, estimate: task.estimate })
      .from(task)
      .innerJoin(system, eq(system.id, task.systemId))
      .where(and(inArray(system.projectId, projectIds), isNull(system.archivedAt))),
  ]);

  const rows = new Map<string, WorkloadRow>();
  const perProject = new Map<string, Map<string, { systems: number; tasksDoing: number }>>();
  const slot = (userId: string, projectId: string) => {
    let byProject = perProject.get(userId);
    if (!byProject) perProject.set(userId, (byProject = new Map()));
    let s = byProject.get(projectId);
    if (!s) byProject.set(projectId, (s = { systems: 0, tasksDoing: 0 }));
    return s;
  };
  const member = new Set(members.map((m) => `${m.userId}:${m.projectId}`));
  for (const m of members) {
    if (rows.has(m.userId)) continue;
    rows.set(m.userId, {
      userId: m.userId,
      name: m.name,
      image: m.image,
      systemsOwned: 0,
      systemsBlocked: 0,
      tasksDoing: 0,
      tasksBlocked: 0,
      openPoints: 0,
      projects: [],
    });
  }

  for (const s of systems) {
    const row = s.owner && member.has(`${s.owner}:${s.projectId}`) ? rows.get(s.owner) : undefined;
    if (!row) continue;
    if (s.category === "blocked") row.systemsBlocked += 1;
    if (s.category !== "done") {
      row.systemsOwned += 1;
      slot(row.userId, s.projectId).systems += 1;
    }
  }
  for (const t of tasks) {
    const row = t.owner && member.has(`${t.owner}:${t.projectId}`) ? rows.get(t.owner) : undefined;
    if (!row) continue;
    if (t.state === "doing") {
      row.tasksDoing += 1;
      slot(row.userId, t.projectId).tasksDoing += 1;
    }
    if (t.state === "blocked") row.tasksBlocked += 1;
    if (t.state !== "done" && t.estimate) row.openPoints += ESTIMATE_POINTS[t.estimate];
  }

  for (const [userId, byProject] of perProject) {
    for (const [projectId, counts] of byProject) {
      if (counts.systems === 0 && counts.tasksDoing === 0) continue;
      const p = byId.get(projectId)!;
      rows.get(userId)!.projects.push({ slug: p.slug, name: p.name, ...counts });
    }
  }
  for (const row of rows.values()) row.projects.sort((a, b) => a.name.localeCompare(b.name));

  return [...rows.values()].sort((a, b) => b.openPoints - a.openPoints || b.tasksDoing - a.tasksDoing || a.name.localeCompare(b.name));
}

export { overloaded };
