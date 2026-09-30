import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { adr, board, boardColumn, changeLog, projectMember, question, system, user, type ColumnCategory } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";

/** What a project card on the home page shows. */
export interface ProjectSummary {
  systems: number;
  byCategory: Partial<Record<ColumnCategory, number>>;
  openQuestions: number;
  lastChange: Date | null;
}

/**
 * Returns the home-page numbers of each project in `projectIds` with three
 * grouped queries, however many projects there are. The caller passes ids it
 * already resolved through {@link listProjects}, which checks access.
 */
export async function projectSummaries(db: Executor, projectIds: string[]): Promise<Map<string, ProjectSummary>> {
  const out = new Map<string, ProjectSummary>();
  if (projectIds.length === 0) return out;
  for (const id of projectIds) out.set(id, { systems: 0, byCategory: {}, openQuestions: 0, lastChange: null });
  const [systems, questions, changes] = await Promise.all([
    db
      .select({ projectId: system.projectId, category: boardColumn.category, n: count() })
      .from(system)
      .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
      .where(inArray(system.projectId, projectIds))
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
 * Returns a project's systems (slug, title, board) in board order, and the
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
      .where(eq(system.projectId, project.id))
      .orderBy(asc(system.sortOrder)),
    db.select({ n: count() }).from(adr).where(eq(adr.projectId, project.id)),
    db
      .select({ n: count() })
      .from(question)
      .where(and(eq(question.projectId, project.id), eq(question.resolved, false))),
    db
      .select({ n: count() })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(eq(projectMember.projectId, project.id)),
  ]);
  return { systems, adrCount: adrs.n, openQuestionCount: questions.n, memberCount: members.n };
}
