import { COLUMN_CATEGORIES, type ColumnCategory } from "@/db/schema/projects";

export type TimeCategory = ColumnCategory | "unknown";

/**
 * Adds up how long a system sat in each column category. Systems start in the
 * planning column; each move ends the previous stay and starts one in its
 * target category. Moves must be sorted by time. Pure.
 *
 * @returns milliseconds per category
 */
export function timeInCategory(input: { createdAt: Date; moves: { at: Date; to: TimeCategory }[]; now: Date }): Record<TimeCategory, number> {
  const out = Object.fromEntries([...COLUMN_CATEGORIES, "unknown"].map((c) => [c, 0])) as Record<TimeCategory, number>;
  let category: TimeCategory = "planning";
  let since = input.createdAt.getTime();
  for (const m of input.moves) {
    out[category] += Math.max(0, m.at.getTime() - since);
    category = m.to;
    since = Math.max(since, m.at.getTime());
  }
  out[category] += Math.max(0, input.now.getTime() - since);
  return out;
}

/**
 * When the system entered the category it is in now: the first move of the run of moves
 * that ended there, so moves between columns of one category don't restart the stay.
 * Systems start in planning; with no move into another category that is `createdAt`.
 */
export function currentSince(input: { createdAt: Date; moves: { at: Date; to: TimeCategory }[] }): Date {
  const { moves } = input;
  const category: TimeCategory = moves.at(-1)?.to ?? "planning";
  let i = moves.length;
  while (i > 0 && moves[i - 1].to === category) i--;
  return i === 0 && category === "planning" ? input.createdAt : moves[i].at;
}
