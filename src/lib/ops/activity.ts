import { and, desc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import { changeLog, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { findSystem } from "./lookup";

/** Filters of {@link listActivity}. */
export const activityFilter = z.object({ system: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) });

/** A change log entry as shown in history lists, with its author split into person and agent. */
export interface HistoryEntry extends AuthorFields {
  id: number;
  entity: string;
  entityId: string;
  /** The system the change belongs to, when it belongs to one. */
  systemId: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
}

/** Selects change log rows matching `conditions`, newest first, with their authors split into person and agent. */
export async function selectHistory(db: Executor, conditions: SQL[], limit: number): Promise<HistoryEntry[]> {
  const rows = await db
    .select({
      id: changeLog.id,
      entity: changeLog.entity,
      entityId: changeLog.entityId,
      systemId: changeLog.systemId,
      field: changeLog.field,
      oldValue: changeLog.oldValue,
      newValue: changeLog.newValue,
      authorName: user.name,
      agent: changeLog.agent,
      createdAt: changeLog.createdAt,
    })
    .from(changeLog)
    .leftJoin(user, eq(user.id, changeLog.authorUserId))
    .where(and(...conditions))
    .orderBy(desc(changeLog.id))
    .limit(limit);
  return rows.map(({ authorName, agent, ...r }) => ({ ...r, ...authorFields(authorName, agent) }));
}

/** Lists the project's changes, or one system's history, newest first. */
export async function listActivity(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof activityFilter> = {},
): Promise<HistoryEntry[]> {
  const filter = activityFilter.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const conditions = [eq(changeLog.projectId, project.id)];
  if (filter.system) conditions.push(eq(changeLog.systemId, (await findSystem(db, project.id, filter.system)).id));
  return selectHistory(db, conditions, filter.limit);
}
