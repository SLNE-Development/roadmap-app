import type { ColumnCategory } from "@/db/schema";

/** A column being edited; `id` is absent for new columns. */
export interface DraftColumn {
  key: string;
  id?: string;
  name: string;
  category: ColumnCategory;
  systemCount: number;
}

/**
 * Refreshes the `systemCount` of each draft column that exists on the server
 * and leaves every other field, and new columns, untouched.
 */
export function mergeColumnCounts(draft: DraftColumn[], server: { id: string; systemCount: number }[]): DraftColumn[] {
  const counts = new Map(server.map((c) => [c.id, c.systemCount]));
  return draft.map((c) => (c.id !== undefined && counts.has(c.id) ? { ...c, systemCount: counts.get(c.id)! } : c));
}
