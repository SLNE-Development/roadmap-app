import type { TaskState } from "@/db/schema";
import type { TaskItem } from "@/lib/ops/systems";

/** The step number of a plan heading such as "Step 3: Wire the API" or "Task 12 - Tests"; null for other headings. */
export function stepNumberOf(headingText: string): number | null {
  const match = /^(?:step|task)\s+(\d{1,3})\b/i.exec(headingText.trim());
  return match ? Number(match[1]) : null;
}

/** The task of each plan step, by step number; tasks without a step are left out. */
export function stepStates(
  tasks: Pick<TaskItem, "id" | "planStep" | "state" | "title">[],
): Map<number, { taskId: number; state: TaskState; title: string }> {
  const states = new Map<number, { taskId: number; state: TaskState; title: string }>();
  for (const t of tasks) {
    if (t.planStep !== null) states.set(t.planStep, { taskId: t.id, state: t.state, title: t.title });
  }
  return states;
}
