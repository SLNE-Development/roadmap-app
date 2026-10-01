import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { question, system, task } from "@/db/schema";
import type { Db } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { OpError } from "./errors";
import { findSystem } from "./lookup";
import { dbInt } from "./params";
import { answerQuestionInput, answerQuestionInTx, questionsOf, type QuestionItem } from "./questions";
import { addTaskInput, addTaskInTx, updateTaskInput, updateTaskInTx, type TaskRow } from "./tasks";

/** Input of {@link addTasks}: 1 to 50 tasks, each with an optional client ref that makes retries safe. */
export const addTasksInput = z.object({
  tasks: z
    .array(addTaskInput.extend({ clientRef: z.string().trim().min(1).max(64).optional().describe("Your stable key, e.g. step-3.") }))
    .min(1)
    .max(50),
});

/** Input of {@link updateTasks}: 1 to 50 task patches, each naming its task. */
export const updateTasksInput = z.object({
  updates: z.array(z.object({ id: dbInt, ...updateTaskInput.shape })).min(1).max(50),
});

/** Input of {@link answerQuestions}: 1 to 50 answers. */
export const answerQuestionsInput = z.object({ answers: z.array(answerQuestionInput).min(1).max(50) });

/** Runs `step` for item `index` (0-based), prefixing an op error's message with the item's 1-based number. */
async function forItem<T>(index: number, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    const message = `Item ${index + 1}: ${error.message}`;
    if (error.constructor === OpError) throw new OpError(message, error.status);
    throw new (error.constructor as new (message: string) => OpError)(message);
  }
}

/**
 * Adds tasks to a system in input order, all or none. An item whose `clientRef`
 * the system already has returns that task unchanged (`created: false`), so a
 * retried call adds nothing twice. Editor or higher.
 */
export async function addTasks(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof addTasksInput>,
): Promise<{ tasks: { id: number; title: string; clientRef: string | null; created: boolean }[] }> {
  const input = addTasksInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    // The system lock serialises batch adds to this system, so no concurrent call can insert
    // the same client ref between the read below and the inserts: no unique violation can occur.
    const parent = await findSystem(tx, project.id, systemSlug, true);
    const refs = [...new Set(input.tasks.flatMap((t) => (t.clientRef ? [t.clientRef] : [])))];
    const existing = new Map<string, { id: number; title: string }>();
    if (refs.length > 0) {
      const rows = await tx
        .select({ id: task.id, title: task.title, clientRef: task.clientRef })
        .from(task)
        .where(and(eq(task.systemId, parent.id), inArray(task.clientRef, refs)));
      for (const row of rows) existing.set(row.clientRef!, row);
    }
    const tasks = [];
    for (const [index, item] of input.tasks.entries()) {
      const known = item.clientRef ? existing.get(item.clientRef) : undefined;
      if (known) {
        tasks.push({ ...known, clientRef: item.clientRef!, created: false });
        continue;
      }
      const { id } = await forItem(index, () => addTaskInTx(tx, actor, parent, item));
      // A ref repeated within the batch returns the task its first use created.
      if (item.clientRef) existing.set(item.clientRef, { id, title: item.title });
      tasks.push({ id, title: item.title, clientRef: item.clientRef ?? null, created: true });
    }
    return { tasks };
  });
}

/**
 * Applies {@link updateTask} to each item in input order, all or none; an error
 * names the failing item ("Item 2: …"). Editor or higher on every task's project.
 */
export async function updateTasks(db: Db, actor: Actor, raw: z.input<typeof updateTasksInput>): Promise<{ tasks: TaskRow[] }> {
  const { updates } = updateTasksInput.parse(raw);
  return db.transaction(async (tx) => {
    const found = await tx
      .select({ systemId: task.systemId })
      .from(task)
      .where(inArray(task.id, updates.map((u) => u.id)));
    const systemIds = [...new Set(found.map((t) => t.systemId))];
    // Lock every system first, in ascending id order, before any task row, so batches cannot deadlock each other or taskAccess.
    if (systemIds.length > 0) {
      await tx.select({ id: system.id }).from(system).where(inArray(system.id, systemIds)).orderBy(asc(system.id)).for("no key update");
    }
    const tasks: TaskRow[] = [];
    for (const [index, { id, ...patch }] of updates.entries()) {
      tasks.push(await forItem(index, () => updateTaskInTx(tx, actor, id, patch)));
    }
    return { tasks };
  });
}

/**
 * Applies {@link answerQuestion} to each item in input order, all or none; an
 * error names the failing item. Editor or higher.
 */
export async function answerQuestions(
  db: Db,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof answerQuestionsInput>,
): Promise<{ questions: QuestionItem[] }> {
  const { answers } = answerQuestionsInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const ids = [...new Set(answers.map((a) => a.id))];
    // Lock the questions in ascending id order so overlapping batches cannot deadlock.
    await tx
      .select({ id: question.id })
      .from(question)
      .where(and(eq(question.projectId, project.id), inArray(question.id, ids)))
      .orderBy(asc(question.id))
      .for("no key update");
    for (const [index, answer] of answers.entries()) {
      await forItem(index, () => answerQuestionInTx(tx, actor, project, answer));
    }
    const byId = new Map((await questionsOf(tx, project.id, { ids })).map((q) => [q.id, q]));
    return { questions: ids.map((id) => byId.get(id)!) };
  });
}
