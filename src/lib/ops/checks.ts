import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { taskCheck } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";
import { logChange } from "./log";
import { taskAccess } from "./tasks";

const checkTitle = z.string().trim().min(1).max(200);

/** Input of {@link addCheck}. */
export const addCheckInput = z.object({ title: checkTitle });

/** Input of {@link updateCheck}; omitted fields stay unchanged. */
export const updateCheckInput = z.object({ title: checkTitle.optional(), done: z.boolean().optional() });

/** Input of {@link setTaskChecks}: the whole checklist, at most 50 items. */
export const setTaskChecksInput = z.object({
  items: z.array(z.object({ title: checkTitle, done: z.boolean().optional() })).max(50),
});

/** Finds the task a check belongs to and checks the actor may edit it, locking the system and task. */
async function checkAccess(tx: Executor, actor: Actor, checkId: string) {
  const unknown = () => new NotFoundError(`Unknown check ${checkId}.`);
  const [found] = await tx.select({ taskId: taskCheck.taskId }).from(taskCheck).where(eq(taskCheck.id, checkId)).limit(1);
  if (!found) throw unknown();
  const access = await taskAccess(tx, actor, found.taskId);
  // The check may have been deleted while the locks were awaited.
  const [current] = await tx.select().from(taskCheck).where(eq(taskCheck.id, checkId)).limit(1);
  if (!current) throw unknown();
  return { check: current, ...access };
}

/** Appends a checklist item to a task. Editor or higher. */
export async function addCheck(db: Db, actor: Actor, taskId: number, raw: z.input<typeof addCheckInput>): Promise<{ id: string }> {
  const input = addCheckInput.parse(raw);
  return db.transaction(async (tx) => {
    // taskAccess locks the task row, so concurrent adds get distinct sort orders.
    const { system: parent } = await taskAccess(tx, actor, taskId);
    const [{ last }] = await tx.select({ last: max(taskCheck.sortOrder) }).from(taskCheck).where(eq(taskCheck.taskId, taskId));
    const id = newId();
    await tx.insert(taskCheck).values({ id, taskId, title: input.title, sortOrder: (last ?? -1) + 1 });
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "check", entityId: id, field: "created", newValue: input.title });
    return { id };
  });
}

/** Changes the title or done state of a checklist item and logs each change. Editor or higher. */
export async function updateCheck(db: Db, actor: Actor, checkId: string, raw: z.input<typeof updateCheckInput>): Promise<void> {
  const patch = updateCheckInput.parse(raw);
  await db.transaction(async (tx) => {
    const { check: current, system: parent } = await checkAccess(tx, actor, checkId);
    const changes: Partial<typeof taskCheck.$inferSelect> = {};
    for (const field of ["title", "done"] as const) {
      const next = patch[field];
      if (next === undefined || next === current[field]) continue;
      Object.assign(changes, { [field]: next });
      await logChange(tx, actor, {
        projectId: parent.projectId,
        systemId: parent.id,
        entity: "check",
        entityId: checkId,
        field,
        oldValue: String(current[field]),
        newValue: String(next),
      });
    }
    if (Object.keys(changes).length > 0) await tx.update(taskCheck).set(changes).where(eq(taskCheck.id, checkId));
  });
}

/** Deletes a checklist item and logs its title. Editor or higher. */
export async function deleteCheck(db: Db, actor: Actor, checkId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { check: current, system: parent } = await checkAccess(tx, actor, checkId);
    await tx.delete(taskCheck).where(eq(taskCheck.id, checkId));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "check", entityId: checkId, field: "deleted", oldValue: current.title });
  });
}

/**
 * Replaces a task's whole checklist in one transaction. Items are matched to
 * existing ones by exact title (keeping their ids), unmatched existing items
 * are deleted and new titles inserted, in the given order. Logs one entry.
 * Editor or higher.
 */
export async function setTaskChecks(
  db: Db,
  actor: Actor,
  taskId: number,
  raw: z.input<typeof setTaskChecksInput>,
): Promise<{ checks: number; done: number }> {
  const { items } = setTaskChecksInput.parse(raw);
  return db.transaction(async (tx) => {
    const { system: parent } = await taskAccess(tx, actor, taskId);
    const existing = await tx.select().from(taskCheck).where(eq(taskCheck.taskId, taskId));
    const unused = new Map<string, string[]>();
    for (const row of existing) unused.set(row.title, [...(unused.get(row.title) ?? []), row.id]);
    const keep = new Set<string>();
    const stored = new Map(existing.map((row) => [row.id, row.done]));
    const rows = items.map((item, sortOrder) => {
      const id = unused.get(item.title)?.shift() ?? newId();
      keep.add(id);
      return { id, taskId, title: item.title, done: item.done ?? stored.get(id) ?? false, sortOrder };
    });
    for (const row of existing) if (!keep.has(row.id)) await tx.delete(taskCheck).where(eq(taskCheck.id, row.id));
    const kept = new Set(existing.map((row) => row.id));
    for (const row of rows) {
      if (kept.has(row.id)) await tx.update(taskCheck).set({ done: row.done, sortOrder: row.sortOrder }).where(eq(taskCheck.id, row.id));
      else await tx.insert(taskCheck).values(row);
    }
    const done = rows.filter((row) => row.done).length;
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "task", entityId: taskId, field: "checks", newValue: `${done}/${rows.length}` });
    return { checks: rows.length, done };
  });
}
