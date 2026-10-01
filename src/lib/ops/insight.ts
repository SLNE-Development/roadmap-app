import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { board, boardColumn, changeLog, COLUMN_CATEGORIES, system, task, type ColumnCategory } from "@/db/schema";
import type { Executor } from "@/db/types";
import { dayKeys } from "@/lib/chart/scale";
import { currentSince, timeInCategory, type TimeCategory } from "@/lib/insight/column-time";
import { projectFinish, replayTasks, sampleBurnup, type BurnupPoint, type Projection, type TaskLogEntry } from "@/lib/insight/burnup";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { findRelease } from "./release-lookup";

const DAY_MS = 86_400_000;

/** Filters of {@link getProgress}: `phase` and `domain` are ids, `board` and `release` are slugs. */
export const progressInput = z.object({
  days: z.union([z.literal(14), z.literal(42), z.literal(90), z.literal(180), z.literal(365)]).default(42),
  phase: z.string().optional(),
  board: z.string().optional(),
  domain: z.string().optional(),
  release: z.string().optional(),
});

/** The task burn-up of a project over the window, with its projected finish. */
export interface Progress {
  points: BurnupPoint[];
  projection: Projection;
  /** The last point's scope minus the first point's. */
  scopeAdded: number;
  totals: { scope: number; done: number };
}

const FIELDS = ["created", "state", "deleted", "moved"] as const;

/**
 * Replays the project's task history into daily scope and done counts.
 * Archived systems' tasks are left out, as are tasks outside the filters.
 *
 * @param now the end of the window, injectable for tests
 * @throws NotFoundError if the project is unknown, the actor is not a member or the `release` is unknown
 */
export async function getProgress(db: Executor, actor: Actor, slug: string, raw: z.input<typeof progressInput>, now: Date = new Date()): Promise<Progress> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const filter = progressInput.parse(raw);
  const filtered = Boolean(filter.phase || filter.board || filter.domain || filter.release);
  const releaseId = filter.release ? (await findRelease(db, project.id, filter.release)).id : null;

  const systems = await db
    .select({ id: system.id, phaseId: system.phaseId, domainId: system.domainId, releaseId: system.releaseId, boardSlug: board.slug, archivedAt: system.archivedAt })
    .from(system)
    .innerJoin(board, eq(board.id, system.boardId))
    .where(eq(system.projectId, project.id));
  const passes = new Map(
    systems.map((s) => [
      s.id,
      !s.archivedAt && (!filter.phase || s.phaseId === filter.phase) && (!filter.domain || s.domainId === filter.domain) && (!filter.board || s.boardSlug === filter.board) && (!releaseId || s.releaseId === releaseId),
    ]),
  );
  const systemOk = (systemId: string | null) => (systemId !== null && passes.has(systemId) ? passes.get(systemId)! : !filtered);

  const systemIds = systems.map((s) => s.id);
  const rows = systemIds.length
    ? await db.select({ id: task.id, state: task.state, systemId: task.systemId }).from(task).where(inArray(task.systemId, systemIds))
    : [];
  const currentIds = new Set(rows.map((r) => r.id));
  const current = rows.filter((r) => passes.get(r.systemId)).map((r) => ({ id: r.id, state: r.state }));
  const currentOk = new Set(current.map((c) => c.id));

  const log = await db
    .select({ id: changeLog.id, entityId: changeLog.entityId, field: changeLog.field, newValue: changeLog.newValue, createdAt: changeLog.createdAt, systemId: changeLog.systemId })
    .from(changeLog)
    .where(and(eq(changeLog.projectId, project.id), eq(changeLog.entity, "task"), inArray(changeLog.field, [...FIELDS])))
    .orderBy(asc(changeLog.id));
  const lastSystem = new Map<number, string | null>();
  for (const r of log) lastSystem.set(Number(r.entityId), r.systemId);
  const entries: TaskLogEntry[] = [];
  for (const r of log) {
    const taskId = Number(r.entityId);
    const keep = currentIds.has(taskId) ? currentOk.has(taskId) : systemOk(lastSystem.get(taskId) ?? null);
    if (keep) entries.push({ taskId, field: r.field as TaskLogEntry["field"], newValue: r.newValue, at: r.createdAt, logId: r.id });
  }

  const lives = replayTasks(entries, current, project.createdAt);
  const from = new Date(Math.max(project.createdAt.getTime(), now.getTime() - (filter.days - 1) * DAY_MS));
  const points = sampleBurnup(lives, dayKeys(from, now), now);
  const last = points.at(-1);
  return {
    points,
    projection: projectFinish(points),
    scopeAdded: last ? last.scope - points[0].scope : 0,
    totals: { scope: last?.scope ?? 0, done: last?.done ?? 0 },
  };
}

/** Filter of {@link getColumnTimes}: `board` is a slug. */
export const columnTimesInput = z.object({ board: z.string().optional() });

/** How long each system has spent in each column category, and the typical time per category. */
export interface ColumnTimes {
  /** Longest in its current column first. */
  systems: { slug: string; title: string; current: ColumnCategory; currentSinceMs: number; byCategory: Record<TimeCategory, number> }[];
  /** Median milliseconds over the systems that spent any time in the category; `null` when none did. */
  medians: Record<ColumnCategory, number | null>;
}

/**
 * Measures the time every system spent in each column category, from its
 * column moves in the change log (`system` / `column`, new value
 * `"<Board name> / <Column name>"`).
 *
 * A move resolves to a category by exact match against the project's current
 * boards and columns. Renaming or deleting a column or board afterwards makes
 * the older moves count as `unknown`. Archived systems are left out.
 *
 * @param now the end of the measured time, injectable for tests
 * @throws NotFoundError if the project is unknown or the actor is not a member
 */
export async function getColumnTimes(db: Executor, actor: Actor, slug: string, raw: z.input<typeof columnTimesInput>, now: Date = new Date()): Promise<ColumnTimes> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const filter = columnTimesInput.parse(raw);

  const columns = await db
    .select({ board: board.name, column: boardColumn.name, category: boardColumn.category })
    .from(boardColumn)
    .innerJoin(board, eq(board.id, boardColumn.boardId))
    .where(eq(board.projectId, project.id));
  const categoryOf = new Map(columns.map((c) => [`${c.board} / ${c.column}`, c.category]));

  const rows = await db
    .select({ id: system.id, slug: system.slug, title: system.title, createdAt: system.createdAt, boardSlug: board.slug, current: boardColumn.category })
    .from(system)
    .innerJoin(board, eq(board.id, system.boardId))
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .where(and(eq(system.projectId, project.id), isNull(system.archivedAt)));
  const wanted = rows.filter((r) => !filter.board || r.boardSlug === filter.board);

  const log = wanted.length
    ? await db
        .select({ systemId: changeLog.entityId, newValue: changeLog.newValue, createdAt: changeLog.createdAt })
        .from(changeLog)
        .where(and(eq(changeLog.projectId, project.id), eq(changeLog.entity, "system"), eq(changeLog.field, "column")))
        .orderBy(asc(changeLog.id))
    : [];
  const movesOf = new Map<string, { at: Date; to: TimeCategory }[]>();
  for (const r of log) {
    const list = movesOf.get(r.systemId) ?? [];
    list.push({ at: r.createdAt, to: categoryOf.get(r.newValue ?? "") ?? "unknown" });
    movesOf.set(r.systemId, list);
  }

  const systems = wanted.map((r) => {
    const moves = movesOf.get(r.id) ?? [];
    const since = currentSince({ createdAt: r.createdAt, moves });
    return {
      slug: r.slug,
      title: r.title,
      current: r.current,
      currentSinceMs: Math.max(0, now.getTime() - since.getTime()),
      byCategory: timeInCategory({ createdAt: r.createdAt, moves, now }),
    };
  });
  systems.sort((a, b) => b.currentSinceMs - a.currentSinceMs);

  const medians = Object.fromEntries(
    COLUMN_CATEGORIES.map((c) => [c, median(systems.map((s) => s.byCategory[c]).filter((ms) => ms > 0))]),
  ) as ColumnTimes["medians"];
  return { systems, medians };
}

/** The median of the values, or `null` for none. */
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
