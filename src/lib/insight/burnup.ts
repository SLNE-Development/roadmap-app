import { TASK_STATES, type TaskState } from "@/db/schema/content";
import { addDays } from "@/lib/chart/scale";

const DAY_MS = 86_400_000;

export type TaskLogEntry = {
  taskId: number;
  field: "created" | "state" | "deleted" | "moved";
  newValue: string | null;
  at: Date;
  logId: number;
};

export type CurrentTask = { id: number; state: TaskState };

/** `states` is sorted and its first entry is at `createdAt`. */
export type TaskLife = {
  taskId: number;
  createdAt: Date;
  deletedAt: Date | null;
  states: { at: Date; state: TaskState }[];
};

export type BurnupPoint = { day: string; scope: number; done: number };

export type Projection =
  | { status: "done" }
  | { status: "none"; reason: "no-pace" | "too-little-history" }
  | { status: "range"; paceLow: number; paceHigh: number; earliest: string; latest: string };

const isState = (value: string | null): value is TaskState => TASK_STATES.some((s) => s === value);

/**
 * Rebuilds every task's life from its change-log entries and the current rows.
 *
 * 1. Group `entries` by `taskId` and order each group by `logId`.
 * 2. `createdAt` is the time of the first `created` entry. With none, it's `origin` (the project's `createdAt`).
 * 3. The state at `createdAt` is `todo`. Each `state` entry appends `{ at, state: newValue }`.
 * 4. `deletedAt` is the time of the first `deleted` entry, or `null`. Entries after `deletedAt` are ignored.
 * 5. For a task that still exists (it's in `current`) whose replayed final state differs from `current.state`, append `{ at: time of that task's last log entry, or createdAt when it has none, state: current.state }`. The current row is the ground truth.
 * 6. A task that is in `entries` but neither in `current` nor deleted (its system was removed by cascade) is treated as deleted at its last log entry's time.
 * 7. `systemId` entries don't change counts. Filtering by phase, board, domain or release uses the task's current system, or for a deleted task the system of its last log entry (the caller resolves that before calling).
 */
export function replayTasks(entries: TaskLogEntry[], current: CurrentTask[], origin: Date): TaskLife[] {
  const groups = new Map<number, TaskLogEntry[]>();
  for (const e of entries) {
    const group = groups.get(e.taskId);
    if (group) group.push(e);
    else groups.set(e.taskId, [e]);
  }
  const currentById = new Map(current.map((t) => [t.id, t]));
  const ids = new Set([...groups.keys(), ...currentById.keys()]);

  const lives: TaskLife[] = [];
  for (const taskId of ids) {
    const group = (groups.get(taskId) ?? []).sort((a, b) => a.logId - b.logId);
    const last = group.at(-1);
    const createdAt = group.find((e) => e.field === "created")?.at ?? origin;
    const deleted = group.find((e) => e.field === "deleted");
    const states: TaskLife["states"] = [{ at: createdAt, state: "todo" }];
    let deletedAt: Date | null = deleted?.at ?? null;

    for (const e of group) {
      if (e === deleted) break;
      // a state entry never predates the task itself
      if (e.field === "state" && isState(e.newValue)) {
        states.push({ at: e.at < createdAt ? createdAt : e.at, state: e.newValue });
      }
    }
    states.sort((a, b) => a.at.getTime() - b.at.getTime());

    const now = currentById.get(taskId);
    if (!deleted && now) {
      if (states.at(-1)!.state !== now.state) states.push({ at: last?.at ?? createdAt, state: now.state });
      states.sort((a, b) => a.at.getTime() - b.at.getTime());
    } else if (!deleted && last) {
      deletedAt = last.at;
    }
    lives.push({ taskId, createdAt, deletedAt, states });
  }
  return lives.sort((a, b) => a.taskId - b.taskId);
}

/** Scope and done counts at the end of each UTC day (at `now` for the day containing it, never later than `now`). */
export function sampleBurnup(lives: TaskLife[], days: string[], now: Date): BurnupPoint[] {
  return days.map((day) => {
    const t = Math.min(Date.parse(`${day}T00:00:00Z`) + DAY_MS - 1, now.getTime());
    let scope = 0;
    let done = 0;
    for (const life of lives) {
      if (life.createdAt.getTime() > t) continue;
      if (life.deletedAt && life.deletedAt.getTime() <= t) continue;
      scope++;
      let state: TaskState = "todo";
      for (const s of life.states) {
        if (s.at.getTime() > t) break;
        state = s.state;
      }
      if (state === "done") done++;
    }
    return { day, scope, done };
  });
}

/** Finish range from the pace of the last 14 days (or all history of 7 to 13 days), pace ×0.8 to ×1.15. */
export function projectFinish(points: BurnupPoint[]): Projection {
  if (points.length < 7) return { status: "none", reason: "too-little-history" };
  const last = points[points.length - 1];
  const from = Math.max(0, points.length - 1 - 14);
  const first = points[from];
  const remaining = last.scope - last.done;
  if (remaining <= 0) return { status: "done" };
  const days = points.length - 1 - from;
  const pace = (last.done - first.done) / days;
  if (!Number.isFinite(pace) || pace <= 0) return { status: "none", reason: "no-pace" };
  const paceHigh = pace * 1.15;
  const paceLow = pace * 0.8;
  return {
    status: "range",
    paceLow,
    paceHigh,
    earliest: addDays(last.day, Math.ceil(remaining / paceHigh)),
    latest: addDays(last.day, Math.ceil(remaining / paceLow)),
  };
}
