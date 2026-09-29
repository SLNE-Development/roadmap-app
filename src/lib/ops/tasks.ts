import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { PRIORITIES, system, task, TASK_STATES } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { projectAccessById } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { systemAccess, userName } from "./lookup";
import { isMember } from "./members";
import { planningGaps } from "./planning";
import { claimSystem } from "./systems";

/** Input of {@link addTask}. */
export const addTaskInput = z.object({ title: z.string().trim().min(1).max(200), priority: z.enum(PRIORITIES).optional() });

/** Input of {@link updateTask}; omitted fields stay unchanged. */
export const updateTaskInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  state: z.enum(TASK_STATES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerUserId: z.string().nullable().optional(),
});

/** Loads a task with its system, locking both rows, and checks the actor's role in its project. */
async function taskAccess(tx: Executor, actor: Actor, taskId: number) {
  const [row] = await tx
    .select({ task, system })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(eq(task.id, taskId))
    .limit(1)
    .for("update");
  if (!row) throw new NotFoundError(`Unknown task ${taskId}.`);
  try {
    await projectAccessById(tx, actor, row.system.projectId, "editor");
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError(`Unknown task ${taskId}.`);
    throw error;
  }
  return row;
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
    const { project, system: parent } = await systemAccess(tx, actor, projectSlug, systemSlug, "editor");
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
 * @throws InvalidError if the owner is not a project member
 */
export async function updateTask(db: Db, actor: Actor, taskId: number, raw: z.input<typeof updateTaskInput>): Promise<void> {
  const patch = updateTaskInput.parse(raw);
  await db.transaction(async (tx) => {
    const { task: current, system: parent } = await taskAccess(tx, actor, taskId);
    if ((patch.state === "doing" || patch.state === "done") && !parent.planningCompletedAt) {
      throw new ConflictError(
        `Task ${taskId} cannot be ${patch.state} while system ${parent.slug} is still in planning. Missing: ${(await planningGaps(tx, parent.id)).join(" ")}`,
      );
    }
    if (patch.ownerUserId && !(await isMember(tx, parent.projectId, patch.ownerUserId))) {
      throw new InvalidError(`User ${patch.ownerUserId} is not a member of this project.`);
    }
    if (patch.state === "doing" && (await isMember(tx, parent.projectId, actor.userId))) {
      if (patch.ownerUserId === undefined && current.ownerUserId === null) patch.ownerUserId = actor.userId;
      await claimSystem(tx, actor, parent);
    }
    const changes: Partial<typeof task.$inferSelect> = {};
    for (const field of ["title", "state", "priority", "ownerUserId"] as const) {
      const next = patch[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(changes, { [field]: next });
      const owner = field === "ownerUserId";
      await logChange(tx, actor, {
        projectId: parent.projectId,
        systemId: parent.id,
        entity: "task",
        entityId: taskId,
        field: owner ? "owner" : field,
        oldValue: owner ? await userName(tx, current.ownerUserId) : current[field],
        newValue: owner ? await userName(tx, next as string | null) : (next as string | null),
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
