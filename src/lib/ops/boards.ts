import { and, count, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { board, boardColumn, COLUMN_CATEGORIES, system, type ColumnCategory } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, isUniqueViolation } from "./errors";
import { logChange } from "./log";
import { findBoard, loadBoards, type BoardWithColumns } from "./lookup";

/** Columns every new board starts with. */
export const DEFAULT_COLUMNS: readonly { name: string; category: ColumnCategory }[] = [
  { name: "Planning", category: "planning" },
  { name: "Todo", category: "todo" },
  { name: "In progress", category: "active" },
  { name: "Review", category: "review" },
  { name: "Blocked", category: "blocked" },
  { name: "Done", category: "done" },
];

/**
 * Returns why a column set is not a valid board, or `null` when it is: a board
 * has exactly one planning column and at least one done column.
 */
export function columnRuleViolation(columns: { category: ColumnCategory }[]): string | null {
  const planning = columns.filter((c) => c.category === "planning").length;
  if (planning !== 1) return `A board needs exactly one planning column; this has ${planning}.`;
  if (!columns.some((c) => c.category === "done")) return "A board needs at least one done column.";
  return null;
}

/** Inserts a board with the default columns and returns it. */
export async function insertBoard(
  tx: Executor,
  projectId: string,
  input: { slug: string; name: string },
  sortOrder: number,
): Promise<BoardWithColumns> {
  const [row] = await tx.insert(board).values({ id: newId(), projectId, slug: input.slug, name: input.name, sortOrder }).returning();
  const columns = await tx
    .insert(boardColumn)
    .values(DEFAULT_COLUMNS.map((c, i) => ({ id: newId(), boardId: row.id, name: c.name, category: c.category, sortOrder: i })))
    .returning();
  return { ...row, columns };
}

/** Input of {@link createBoard}. */
export const createBoardInput = z.object({ slug: slugSchema, name: z.string().trim().min(1).max(60) });

/** Input of {@link updateBoard}; omitted fields stay unchanged. */
export const updateBoardInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

/** One column in {@link setColumnsInput}: an existing column (with `id`) or a new one. */
export const columnInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(40),
  category: z.enum(COLUMN_CATEGORIES),
});

/** Input of {@link setBoardColumns}: the complete new column list, in order. */
export const setColumnsInput = z.object({ columns: z.array(columnInput).min(2).max(20) });

/** Lists the project's boards with their columns. */
export async function listBoards(db: Executor, actor: Actor, projectSlug: string): Promise<BoardWithColumns[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  return loadBoards(db, project.id);
}

/**
 * Adds a board with the default columns after the existing boards. Owner only.
 *
 * @throws ConflictError if the slug is taken in this project
 */
export async function createBoard(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createBoardInput>): Promise<BoardWithColumns> {
  const input = createBoardInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project } = await projectAccess(tx, actor, projectSlug, "owner");
      const [{ last }] = await tx.select({ last: max(board.sortOrder) }).from(board).where(eq(board.projectId, project.id));
      const created = await insertBoard(tx, project.id, input, (last ?? -1) + 1);
      await logChange(tx, actor, { projectId: project.id, entity: "board", entityId: created.id, field: "created", newValue: created.name });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Board slug ${input.slug} is taken in this project.`);
    throw error;
  }
}

/** Renames a board or changes its position. Owner only. */
export async function updateBoard(
  db: Db,
  actor: Actor,
  projectSlug: string,
  boardSlug: string,
  raw: z.input<typeof updateBoardInput>,
): Promise<void> {
  const patch = updateBoardInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findBoard(tx, project.id, boardSlug);
    if (patch.name !== undefined && patch.name !== current.name) {
      await logChange(tx, actor, { projectId: project.id, entity: "board", entityId: current.id, field: "name", oldValue: current.name, newValue: patch.name });
    }
    if (patch.name !== undefined || patch.sortOrder !== undefined) {
      await tx.update(board).set(patch).where(eq(board.id, current.id));
    }
  });
}

/**
 * Replaces a board's columns with `columns`, in that order: listed ids are kept
 * (renamed, recategorised, reordered), entries without id are created, and
 * existing columns missing from the list are deleted. Owner only.
 *
 * @throws ConflictError if the result breaks {@link columnRuleViolation}, a deleted
 *         column still holds systems, or a planning column holding unplanned systems changes category
 * @throws InvalidError if an id belongs to another board
 */
export async function setBoardColumns(
  db: Db,
  actor: Actor,
  projectSlug: string,
  boardSlug: string,
  raw: z.input<typeof setColumnsInput>,
): Promise<BoardWithColumns> {
  const { columns } = setColumnsInput.parse(raw);
  const violation = columnRuleViolation(columns);
  if (violation) throw new ConflictError(violation);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findBoard(tx, project.id, boardSlug);
    const byId = new Map(current.columns.map((c) => [c.id, c]));
    for (const c of columns) {
      if (c.id && !byId.has(c.id)) throw new InvalidError(`Column ${c.id} is not on board ${boardSlug}.`);
    }
    const keptIds = new Set(columns.flatMap((c) => (c.id ? [c.id] : [])));
    const removed = current.columns.filter((c) => !keptIds.has(c.id));
    if (removed.length > 0) {
      const counts = await tx
        .select({ columnId: system.columnId, n: count() })
        .from(system)
        .where(inArray(system.columnId, removed.map((c) => c.id)))
        .groupBy(system.columnId);
      const busy = counts.find((c) => c.n > 0);
      if (busy) {
        const name = byId.get(busy.columnId)?.name;
        throw new ConflictError(`Column "${name}" still holds ${busy.n} system${busy.n === 1 ? "" : "s"}; move ${busy.n === 1 ? "it" : "them"} first.`);
      }
    }
    for (const c of columns) {
      const old = c.id ? byId.get(c.id) : undefined;
      if (old?.category === "planning" && c.category !== "planning") {
        const unplanned = await tx
          .select({ id: system.id })
          .from(system)
          .where(and(eq(system.columnId, old.id), isNull(system.planningCompletedAt)))
          .limit(1);
        if (unplanned.length > 0) {
          throw new ConflictError(`Column "${old.name}" holds systems that are still in planning; it must stay the planning column.`);
        }
      }
    }
    if (removed.length > 0) await tx.delete(boardColumn).where(inArray(boardColumn.id, removed.map((c) => c.id)));
    for (const [i, c] of columns.entries()) {
      if (c.id) await tx.update(boardColumn).set({ name: c.name, category: c.category, sortOrder: i }).where(eq(boardColumn.id, c.id));
      else await tx.insert(boardColumn).values({ id: newId(), boardId: current.id, name: c.name, category: c.category, sortOrder: i });
    }
    await logChange(tx, actor, {
      projectId: project.id,
      entity: "board",
      entityId: current.id,
      field: "columns",
      oldValue: current.columns.map((c) => c.name).join(" → "),
      newValue: columns.map((c) => c.name).join(" → "),
    });
    return findBoard(tx, project.id, boardSlug);
  });
}
