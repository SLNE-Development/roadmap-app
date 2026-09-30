import type { ColumnCategory } from "@/db/schema";

/** Returns the share of items in a done column as a whole percentage (0 when empty). */
export function categoryProgress(items: { columnCategory: ColumnCategory }[]): number {
  if (items.length === 0) return 0;
  return Math.round((items.filter((i) => i.columnCategory === "done").length / items.length) * 100);
}
