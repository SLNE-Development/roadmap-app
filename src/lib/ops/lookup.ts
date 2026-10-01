import { and, asc, eq, getTableColumns, inArray } from "drizzle-orm";
import { board, boardColumn, project, system, user, type ProjectRole } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess, type ProjectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError } from "./errors";

/** A system row without its generated full-text `search` vector, which never leaves the database. */
export type SystemRow = Omit<typeof system.$inferSelect, "search">;

type SystemColumns = Omit<(typeof system)["_"]["columns"], "search">;

/** The columns of {@link SystemRow}, for `select` and `returning`. */
export const systemColumns: SystemColumns = (() => {
  const columns: Partial<(typeof system)["_"]["columns"]> = { ...getTableColumns(system) };
  delete columns.search;
  return columns as SystemColumns;
})();

/** A board row. */
export type BoardRow = typeof board.$inferSelect;

/** A board column row. */
export type BoardColumnRow = typeof boardColumn.$inferSelect;

/** A board with its columns in order. */
export interface BoardWithColumns extends BoardRow {
  columns: BoardColumnRow[];
}

/** Throws when the system is archived, so writes to it are refused until it is restored. */
export function assertSystemActive(row: SystemRow): void {
  if (row.archivedAt) throw new ConflictError(`System ${row.slug} is archived; restore it first.`);
}

/**
 * Returns the system with `slug` in the project, optionally locking its row
 * until the surrounding transaction ends. Locking marks the write path, which
 * refuses an archived system unless `opts.allowArchived`.
 *
 * @throws NotFoundError if there is none
 * @throws ConflictError if `lock` is set and the system is archived
 */
export async function findSystem(
  db: Executor,
  projectId: string,
  slug: string,
  lock = false,
  opts?: { allowArchived?: boolean },
): Promise<SystemRow> {
  const query = db
    .select(systemColumns)
    .from(system)
    .where(and(eq(system.projectId, projectId), eq(system.slug, slug)))
    .limit(1);
  const [row] = lock ? await query.for("no key update") : await query;
  if (!row) throw new NotFoundError(`Unknown system ${slug}.`);
  if (lock && !opts?.allowArchived) assertSystemActive(row);
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

/**
 * Checks project access with `need` and returns the access together with the
 * system. Above viewer it is a write: the system row is locked and an archived
 * system is refused.
 */
export async function systemAccess(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  need: ProjectRole,
): Promise<ProjectAccess & { system: SystemRow }> {
  const found = await projectAccess(db, actor, projectSlug, need);
  return { ...found, system: await findSystem(db, found.project.id, systemSlug, need !== "viewer") };
}

/** Returns a user's name, or `null` for no user or an unknown id. */
export async function userName(db: Executor, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? null;
}
