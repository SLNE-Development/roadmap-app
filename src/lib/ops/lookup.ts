import { and, asc, eq, inArray } from "drizzle-orm";
import { board, boardColumn, project, system, user, type ProjectRole } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess, type ProjectAccess } from "./access";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

/** A system row. */
export type SystemRow = typeof system.$inferSelect;

/** A board row. */
export type BoardRow = typeof board.$inferSelect;

/** A board column row. */
export type BoardColumnRow = typeof boardColumn.$inferSelect;

/** A board with its columns in order. */
export interface BoardWithColumns extends BoardRow {
  columns: BoardColumnRow[];
}

/**
 * Returns the system with `slug` in the project, optionally locking its row
 * until the surrounding transaction ends.
 *
 * @throws NotFoundError if there is none
 */
export async function findSystem(db: Executor, projectId: string, slug: string, lock = false): Promise<SystemRow> {
  const query = db
    .select()
    .from(system)
    .where(and(eq(system.projectId, projectId), eq(system.slug, slug)))
    .limit(1);
  const [row] = lock ? await query.for("no key update") : await query;
  if (!row) throw new NotFoundError(`Unknown system ${slug}.`);
  return row;
}

/** Returns every board of a project in order, each with its columns in order. */
export async function loadBoards(db: Executor, projectId: string): Promise<BoardWithColumns[]> {
  const boards = await db.select().from(board).where(eq(board.projectId, projectId)).orderBy(asc(board.sortOrder), asc(board.name));
  if (boards.length === 0) return [];
  const columns = await db
    .select()
    .from(boardColumn)
    .where(
      inArray(
        boardColumn.boardId,
        boards.map((b) => b.id),
      ),
    )
    .orderBy(asc(boardColumn.sortOrder));
  return boards.map((b) => ({ ...b, columns: columns.filter((c) => c.boardId === b.id) }));
}

/**
 * Returns the board with `slug` in the project, with its columns, optionally
 * locking the board row until the surrounding transaction ends.
 *
 * @throws NotFoundError if there is none
 */
export async function findBoard(db: Executor, projectId: string, slug: string, lock = false): Promise<BoardWithColumns> {
  const query = db
    .select()
    .from(board)
    .where(and(eq(board.projectId, projectId), eq(board.slug, slug)))
    .limit(1);
  const [row] = lock ? await query.for("no key update") : await query;
  if (!row) throw new NotFoundError(`Unknown board ${slug}.`);
  const columns = await db.select().from(boardColumn).where(eq(boardColumn.boardId, row.id)).orderBy(asc(boardColumn.sortOrder));
  return { ...row, columns };
}

/** Locks the project row until the surrounding transaction ends, so writers allocating numbers or sort orders under it run one at a time. */
export async function lockProject(tx: Executor, projectId: string): Promise<void> {
  await tx.select({ id: project.id }).from(project).where(eq(project.id, projectId)).for("no key update");
}

/** Checks project access with `need` and returns the access together with the system. */
export async function systemAccess(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  need: ProjectRole,
): Promise<ProjectAccess & { system: SystemRow }> {
  const found = await projectAccess(db, actor, projectSlug, need);
  return { ...found, system: await findSystem(db, found.project.id, systemSlug) };
}

/** Returns a user's name, or `null` for no user or an unknown id. */
export async function userName(db: Executor, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? null;
}
