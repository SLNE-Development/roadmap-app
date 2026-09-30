import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { changeLog, user } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import { authorLabel, type Actor } from "./actor";
import { findSystem } from "./lookup";

/** Filters of {@link listActivity}. */
export const activityFilter = z.object({ system: z.string().optional(), limit: z.number().int().min(1).max(500).default(100) });

/** A change log entry as shown in history lists. */
export interface HistoryEntry {
  id: number;
  entity: string;
  entityId: string;
  /** The system the change belongs to, when it belongs to one. */
  systemId: string | null;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  author: string;
  createdAt: Date;
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
    .limit(filter.limit);
  return rows.map(({ authorName, agent, ...r }) => ({ ...r, author: authorLabel(authorName, agent) }));
}
