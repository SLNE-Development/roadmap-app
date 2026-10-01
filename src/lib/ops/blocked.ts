import { and, eq, inArray, isNull, max } from "drizzle-orm";
import { changeLog, system, task } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";

/** A blocked task with the system it belongs to. */
export interface BlockedTask {
  id: number;
  title: string;
  reason: string | null;
  systemSlug: string;
  systemTitle: string;
  /** When the task was last set to blocked, from the change log. */
  since: Date | null;
}

/** Lists the project's blocked tasks outside archived systems, longest-blocked first, with their reason and since when. Viewer or higher. */
export async function listBlockedTasks(db: Executor, actor: Actor, projectSlug: string): Promise<BlockedTask[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const rows = await db
    .select({ id: task.id, title: task.title, reason: task.blockedReason, systemSlug: system.slug, systemTitle: system.title })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(and(eq(system.projectId, project.id), isNull(system.archivedAt), eq(task.state, "blocked")))
    .orderBy(task.id);
  if (rows.length === 0) return [];
  const since = await db
    .select({ entityId: changeLog.entityId, at: max(changeLog.createdAt) })
    .from(changeLog)
    .where(
      and(
        eq(changeLog.projectId, project.id),
        eq(changeLog.entity, "task"),
        eq(changeLog.field, "state"),
        eq(changeLog.newValue, "blocked"),
        inArray(changeLog.entityId, rows.map((r) => String(r.id))),
      ),
    )
    .groupBy(changeLog.entityId);
  const at = new Map(since.map((s) => [s.entityId, s.at]));
  return rows
    .map((r) => ({ ...r, since: at.get(String(r.id)) ?? null }))
    .sort((a, b) => (a.since?.getTime() ?? Infinity) - (b.since?.getTime() ?? Infinity) || a.id - b.id);
}
