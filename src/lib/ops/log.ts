import { changeLog } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";

/** One change to record: which entity and field changed, from what to what. */
export interface ChangeEntry {
  projectId: string;
  systemId?: string | null;
  entity: string;
  entityId: string | number;
  field: string;
  oldValue?: string | null;
  newValue?: string | null;
}

/**
 * Appends `entry` to the change log, attributed to the actor and their agent.
 *
 * @param db the database or the transaction the change happens in
 * @param actor who made the change
 * @param entry what changed
 */
export async function logChange(db: Executor, actor: Actor, entry: ChangeEntry): Promise<void> {
  await db.insert(changeLog).values({
    projectId: entry.projectId,
    systemId: entry.systemId ?? null,
    entity: entry.entity,
    entityId: String(entry.entityId),
    field: entry.field,
    oldValue: entry.oldValue ?? null,
    newValue: entry.newValue ?? null,
    authorUserId: actor.userId,
    agent: actor.agent ?? null,
  });
}
