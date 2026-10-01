import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { system, task, TASK_ESTIMATES } from "@/db/schema";
import type { Executor } from "@/db/types";
import { ESTIMATE_POINTS, rollup, type Rollup } from "@/lib/rollup";
import { projectAccess } from "./access";
import type { Actor } from "./actor";

export { ESTIMATE_POINTS, rollup, type Rollup };

/** SQL expression turning `task.estimate` into its points. */
const POINTS = sql`case ${task.estimate} ${sql.raw(TASK_ESTIMATES.map((e) => `when '${e}' then ${ESTIMATE_POINTS[e]}`).join(" "))} else 0 end`;

/** The aggregate columns shared by the rollup queries. */
const AGGREGATES = {
  tasks: sql<number>`count(*)`.mapWith(Number),
  done: sql<number>`count(*) filter (where ${task.state} = 'done')`.mapWith(Number),
  points: sql<number>`coalesce(sum(${POINTS}), 0)`.mapWith(Number),
  pointsDone: sql<number>`coalesce(sum(${POINTS}) filter (where ${task.state} = 'done'), 0)`.mapWith(Number),
  unestimated: sql<number>`count(*) filter (where ${task.estimate} is null)`.mapWith(Number),
};

/**
 * Rolls up the tasks of each system of the project in one grouped query. Systems without tasks are absent,
 * and so are archived systems unless `systemIds` names the systems to roll up.
 */
export async function systemRollups(db: Executor, projectId: string, systemIds?: string[]): Promise<Map<string, Rollup>> {
  if (systemIds?.length === 0) return new Map();
  const rows = await db
    .select({ systemId: task.systemId, ...AGGREGATES })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(and(eq(system.projectId, projectId), systemIds ? inArray(task.systemId, systemIds) : isNull(system.archivedAt)))
    .groupBy(task.systemId);
  return new Map(rows.map(({ systemId, ...r }) => [systemId, r]));
}

/**
 * Rolls up the project's tasks by phase, domain or board in one grouped query; the key `null` holds systems without a phase or domain.
 * Archived systems are left out.
 */
export async function groupRollups(db: Executor, projectId: string, by: "phase" | "domain" | "board"): Promise<Map<string | null, Rollup>> {
  const key = by === "phase" ? system.phaseId : by === "domain" ? system.domainId : system.boardId;
  const rows = await db
    .select({ key, ...AGGREGATES })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(and(eq(system.projectId, projectId), isNull(system.archivedAt)))
    .groupBy(key);
  return new Map(rows.map(({ key: k, ...r }) => [k, r]));
}

/** Rolls up the project's tasks per phase (`phaseId` null for systems without one). Viewer or higher. */
export async function phaseRollups(db: Executor, actor: Actor, projectSlug: string): Promise<({ phaseId: string | null } & Rollup)[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const groups = await groupRollups(db, project.id, "phase");
  return [...groups].map(([phaseId, r]) => ({ phaseId, ...r }));
}
