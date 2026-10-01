import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { board, changeLog, system, task } from "@/db/schema";
import type { Executor } from "@/db/types";
import { dayKeys } from "@/lib/chart/scale";
import { projectFinish, replayTasks, sampleBurnup, type BurnupPoint, type Projection, type TaskLogEntry } from "@/lib/insight/burnup";
import { projectAccess } from "./access";
import type { Actor } from "./actor";

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
 * Archived systems' tasks are left out, as are tasks outside the filters; the
 * `release` filter is accepted and not applied yet.
 *
 * @param now the end of the window, injectable for tests
 * @throws NotFoundError if the project is unknown or the actor is not a member
 */
export async function getProgress(db: Executor, actor: Actor, slug: string, raw: z.input<typeof progressInput>, now: Date = new Date()): Promise<Progress> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const filter = progressInput.parse(raw);
  const filtered = Boolean(filter.phase || filter.board || filter.domain);

  const systems = await db
    .select({ id: system.id, phaseId: system.phaseId, domainId: system.domainId, boardSlug: board.slug, archivedAt: system.archivedAt })
    .from(system)
    .innerJoin(board, eq(board.id, system.boardId))
    .where(eq(system.projectId, project.id));
  const passes = new Map(
    systems.map((s) => [
      s.id,
      !s.archivedAt && (!filter.phase || s.phaseId === filter.phase) && (!filter.domain || s.domainId === filter.domain) && (!filter.board || s.boardSlug === filter.board),
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
