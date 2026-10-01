import type { WorkloadRow } from "./ops/workload";

/** Returns the ids of people whose open points exceed twice the median of all rows (none when the median is 0). Pure. */
export function overloaded(rows: WorkloadRow[]): Set<string> {
  if (rows.length === 0) return new Set();
  const sorted = rows.map((r) => r.openPoints).sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  if (median === 0) return new Set();
  return new Set(rows.filter((r) => r.openPoints > 2 * median).map((r) => r.userId));
}
