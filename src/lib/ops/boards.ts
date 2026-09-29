import { board, boardColumn, type ColumnCategory } from "@/db/schema";
import type { Executor } from "@/db/types";
import { newId } from "@/lib/id";
import type { BoardWithColumns } from "./lookup";

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
