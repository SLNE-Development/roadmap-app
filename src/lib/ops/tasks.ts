import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { PRIORITIES, system, task, TASK_STATES } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { projectAccess, projectAccessById } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem, userName } from "./lookup";
import { isMember } from "./members";
import { nullableEntityId } from "./params";
import { planningGaps } from "./planning";
import { claimSystem } from "./systems";

/** Input of {@link addTask}. */
export const addTaskInput = z.object({ title: z.string().trim().min(1).max(200), priority: z.enum(PRIORITIES).optional() });

/** Input of {@link updateTask}; omitted fields stay unchanged. */
export const updateTaskInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  state: z.enum(TASK_STATES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerUserId: nullableEntityId.optional(),
  notes: z.string().max(5000).optional(),
  blockedReason: z.string().trim().min(1).max(300).optional(),
});

/** Notes are logged cut to this many characters, so the change log does not store whole notes twice. */
const NOTES_LOG_LENGTH = 200;

/** Cuts a note to {@link NOTES_LOG_LENGTH} characters plus an ellipsis for the change log. */
function logNote(note: string): string {
  return note.length > NOTES_LOG_LENGTH ? `${note.slice(0, NOTES_LOG_LENGTH)}…` : note;
}

/** Loads a task with its system, locking both rows, and checks the actor's role in its project. */
async function taskAccess(tx: Executor, actor: Actor, taskId: number) {
  const unknown = () => new NotFoundError(`Unknown task ${taskId}.`);
  const [found] = await tx.select({ systemId: task.systemId }).from(task).where(eq(task.id, taskId)).limit(1);
  if (!found) throw unknown();
  // Lock the system before the task, the order writePlan uses, so the two cannot deadlock.
  const [parent] = await tx.select().from(system).where(eq(system.id, found.systemId)).limit(1).for("no key update");
  if (!parent) throw unknown();
  const [current] = await tx.select().from(task).where(eq(task.id, taskId)).limit(1).for("no key update");
  if (!current || current.systemId !== parent.id) throw unknown();
  try {
    await projectAccessById(tx, actor, parent.projectId, "editor");
  } catch (error) {
    if (error instanceof NotFoundError) throw unknown();
    throw error;
  }
  return { task: current, system: parent };
}

/** Adds a task at the end of a system's list; priority defaults to the system's. Editor or higher. */
export async function addTask(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof addTaskInput>,
): Promise<{ id: number }> {
  const input = addTaskInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    // Lock the system row so concurrent adds get distinct sort orders.
    const parent = await findSystem(tx, project.id, systemSlug, true);
    const [{ last }] = await tx.select({ last: max(task.sortOrder) }).from(task).where(eq(task.systemId, parent.id));
    const [row] = await tx
      .insert(task)
      .values({ systemId: parent.id, title: input.title, priority: input.priority ?? parent.priority, sortOrder: (last ?? -1) + 1 })
      .returning({ id: task.id });
    await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "task", entityId: row.id, field: "created", newValue: input.title });
    return row;
  });
}

/**
 * Changes a task and logs each changed field. Editor or higher. Setting `doing`
 * assigns the actor (when they are a project member) as owner of an unowned
 * task and of the unowned system; existing owners are never replaced.
 *
 * @throws ConflictError when setting `doing` or `done` while the system is in planning
 * @throws InvalidError if the owner is not a project member, if blocking without a reason,
 *   or if a reason is given for a task that is not blocked
 */
export async function updateTask(db: Db, actor: Actor, taskId: number, raw: z.input<typeof updateTaskInput>): Promise<void> {
  const patch = updateTaskInput.parse(raw);
  await db.transaction(async (tx) => {
    const { task: current, system: parent } = await taskAccess(tx, actor, taskId);
    if ((patch.state === "doing" || patch.state === "done") && !parent.planningCompletedAt) {
      const gaps = await planningGaps(tx, parent.id);
      const head = `Task ${taskId} cannot be ${patch.state} while system ${parent.slug} is still in planning.`;
      throw new ConflictError(gaps.length ? `${head} Missing: ${gaps.join(" ")}` : `${head} Call complete_planning first.`);
    }
    if (patch.ownerUserId && !(await isMember(tx, parent.projectId, patch.ownerUserId))) {
      throw new InvalidError(`User ${patch.ownerUserId} is not a member of this project.`);
    }
    const nextState = patch.state ?? current.state;
    if (patch.blockedReason !== undefined && nextState !== "blocked") throw new InvalidError(`Task ${taskId} is not blocked.`);
    if (patch.state === "blocked" && !(patch.blockedReason ?? current.blockedReason)) {
      throw new InvalidError(`Say what task ${taskId} is waiting for: pass blockedReason.`);
    }
    // Leaving the blocked state drops the reason.
    const blockedReason = patch.state !== undefined && patch.state !== "blocked" ? null : patch.blockedReason;
    if (patch.state === "doing" && (await isMember(tx, parent.projectId, actor.userId))) {
      if (patch.ownerUserId === undefined && current.ownerUserId === null) patch.ownerUserId = actor.userId;
      await claimSystem(tx, actor, parent);
    }
    const changes: Partial<typeof task.$inferSelect> = {};
    for (const field of ["title", "state", "priority", "ownerUserId", "notes", "blockedReason"] as const) {
      const next = field === "blockedReason" ? blockedReason : patch[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(changes, { [field]: next });
      const owner = field === "ownerUserId";
      const note = field === "notes";
      await logChange(tx, actor, {
        projectId: parent.projectId,
        systemId: parent.id,
        entity: "task",
        entityId: taskId,
        field: owner ? "owner" : field,
        oldValue: owner ? await userName(tx, current.ownerUserId) : note ? logNote(current.notes) : current[field],
        newValue: owner ? await userName(tx, next as string | null) : note ? logNote(next as string) : (next as string | null),
      });
    }
    if (Object.keys(changes).length > 0) await tx.update(task).set(changes).where(eq(task.id, taskId));
  });
}

/** Deletes a task and logs its title. Editor or higher. */
export async function deleteTask(db: Db, actor: Actor, taskId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const { task: current, system: parent } = await taskAccess(tx, actor, taskId);
    await tx.delete(task).where(eq(task.id, taskId));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "task", entityId: taskId, field: "deleted", oldValue: current.title });
  });
}
