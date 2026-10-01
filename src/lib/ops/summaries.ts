import { and, asc, count, eq, inArray, isNull, max, or } from "drizzle-orm";
import { adr, allowedAccount, board, boardColumn, changeLog, projectMember, question, system, user, type ColumnCategory } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectHealth, type ProjectHealth } from "@/lib/health";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { lastActivityBySystemMany, STALE_SYSTEM_DAYS } from "./attention";

/** What a project card on the home page shows. */
export interface ProjectSummary {
  systems: number;
  byCategory: Partial<Record<ColumnCategory, number>>;
  openQuestions: number;
  lastChange: Date | null;
  health: ProjectHealth;
}

/**
 * Returns the home-page numbers of each project in `projectIds` with a fixed
 * number of grouped queries, however many projects there are, including its
 * health as of `now`. Archived systems are not counted. The caller passes ids it
 * already resolved through {@link listProjects}, which checks access.
 */
export async function projectSummaries(db: Executor, projectIds: string[], now: Date = new Date()): Promise<Map<string, ProjectSummary>> {
  const out = new Map<string, ProjectSummary>();
  if (projectIds.length === 0) return out;
  const empty = projectHealth({ systems: 0, notDone: 0, blocked: 0, activeOrReview: 0, staleSystems: 0, blockingQuestions: 0, lastChange: null, now });
  for (const id of projectIds) out.set(id, { systems: 0, byCategory: {}, openQuestions: 0, lastChange: null, health: empty });
  const [systems, questions, changes, inProgress, blocking, activity] = await Promise.all([
    db
      .select({ projectId: system.projectId, category: boardColumn.category, n: count() })
      .from(system)
      .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
      .where(and(inArray(system.projectId, projectIds), isNull(system.archivedAt)))
      .groupBy(system.projectId, boardColumn.category),
    db
      .select({ projectId: question.projectId, n: count() })
      .from(question)
      .where(and(inArray(question.projectId, projectIds), eq(question.resolved, false)))
      .groupBy(question.projectId),
    db
      .select({ projectId: changeLog.projectId, last: max(changeLog.createdAt) })
      .from(changeLog)
      .where(inArray(changeLog.projectId, projectIds))
      .groupBy(changeLog.projectId),
    db
      .select({ id: system.id, projectId: system.projectId, createdAt: system.createdAt })
      .from(system)
      .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
      .where(and(inArray(system.projectId, projectIds), isNull(system.archivedAt), inArray(boardColumn.category, ["active", "review"]))),
    db
      .select({ projectId: question.projectId, n: count() })
      .from(question)
      .leftJoin(system, eq(system.id, question.systemId))
      .where(and(inArray(question.projectId, projectIds), eq(question.resolved, false), eq(question.priority, "blocking"), or(isNull(question.systemId), isNull(system.archivedAt))))
      .groupBy(question.projectId),
    lastActivityBySystemMany(db, projectIds),
  ]);
  for (const row of systems) {
    const s = out.get(row.projectId);
    if (!s) continue;
    s.systems += row.n;
    s.byCategory[row.category] = row.n;
  }
  for (const row of questions) {
    const s = out.get(row.projectId);
    if (s) s.openQuestions = row.n;
  }
  for (const row of changes) {
    const s = out.get(row.projectId);
    if (s) s.lastChange = row.last;
  }
  const staleBefore = now.getTime() - STALE_SYSTEM_DAYS * 86_400_000;
  const stale = new Map<string, number>();
  for (const row of inProgress) {
    if ((activity.get(row.id) ?? row.createdAt).getTime() < staleBefore) stale.set(row.projectId, (stale.get(row.projectId) ?? 0) + 1);
  }
  const blockingByProject = new Map(blocking.map((row) => [row.projectId, row.n]));
  for (const [id, s] of out) {
    const notDone = s.systems - (s.byCategory.done ?? 0);
    s.health = projectHealth({
      systems: s.systems,
      notDone,
      blocked: s.byCategory.blocked ?? 0,
      activeOrReview: (s.byCategory.active ?? 0) + (s.byCategory.review ?? 0),
      staleSystems: stale.get(id) ?? 0,
      blockingQuestions: blockingByProject.get(id) ?? 0,
      lastChange: s.lastChange,
      now,
    });
  }
  return out;
}

/** What the project sidebar and command menu need. */
export interface ProjectNav {
  systems: { slug: string; title: string; boardSlug: string }[];
  adrCount: number;
  openQuestionCount: number;
  memberCount: number;
}

/**
 * Returns a project's systems (slug, title, board) in board order, leaving out archived ones, and the
 * sidebar's ADR, open-question and member counts, with light queries instead
 * of the full system listing.
 *
 * @throws NotFoundError if the actor cannot see the project
 */
export async function projectNav(db: Executor, actor: Actor, slug: string): Promise<ProjectNav> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const [systems, [adrs], [questions], [members]] = await Promise.all([
    db
      .select({ slug: system.slug, title: system.title, boardSlug: board.slug })
      .from(system)
      .innerJoin(board, eq(board.id, system.boardId))
      .where(and(eq(system.projectId, project.id), isNull(system.archivedAt)))
      .orderBy(asc(board.sortOrder), asc(system.sortOrder)),
    db.select({ n: count() }).from(adr).where(eq(adr.projectId, project.id)),
    db
      .select({ n: count() })
      .from(question)
      .where(and(eq(question.projectId, project.id), eq(question.resolved, false))),
    db
      .select({ n: count() })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
      .where(eq(projectMember.projectId, project.id)),
  ]);
  return { systems, adrCount: adrs.n, openQuestionCount: questions.n, memberCount: members.n };
}
