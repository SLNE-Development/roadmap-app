import type { TaskEstimate, TaskState } from "@/db/schema";

/** Points an estimate counts for; tasks without an estimate count 0 and are reported as unestimated. */
export const ESTIMATE_POINTS: Record<TaskEstimate, number> = { S: 1, M: 3, L: 8 };

/** Task counts and estimate points of a system or a group of systems. */
export interface Rollup {
  tasks: number;
  done: number;
  points: number;
  pointsDone: number;
  unestimated: number;
}

/** Sums tasks, done tasks, points and unestimated tasks. Pure. */
export function rollup(tasks: { state: TaskState; estimate: TaskEstimate | null }[]): Rollup {
  const result: Rollup = { tasks: tasks.length, done: 0, points: 0, pointsDone: 0, unestimated: 0 };
  for (const t of tasks) {
    const points = t.estimate ? ESTIMATE_POINTS[t.estimate] : 0;
    result.points += points;
    if (t.estimate === null) result.unestimated += 1;
    if (t.state === "done") {
      result.done += 1;
      result.pointsDone += points;
    }
  }
  return result;
}
