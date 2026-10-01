import "server-only";
import { z } from "zod";
import { listBlockedTasks } from "@/lib/ops/blocked";
import { addCheck, addCheckInput, deleteCheck, updateCheck, updateCheckInput } from "@/lib/ops/checks";
import { dbInt, entityId } from "@/lib/ops/params";
import { addTask, addTaskInput, deleteTask, moveTask, moveTaskInput, reorderTasks, reorderTasksInput, updateTask, updateTaskInput } from "@/lib/ops/tasks";
import { protectedProcedure, router } from "../init";
import { P, S } from "./shared";

/** A task by its id. */
const TASK = { id: dbInt };

/** A check by its id. */
const CHECK = { id: entityId };

/** Tasks of a system; they are read through `systems.overview`, except the blocked ones. */
export const tasksRouter = router({
  /** The project's blocked tasks with their reasons. */
  blocked: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listBlockedTasks(ctx.db, ctx.actor, input.project)),

  /** Adds a task to a system. */
  add: protectedProcedure
    .input(z.object({ ...S, task: addTaskInput }))
    .mutation(async ({ ctx, input }) => void (await addTask(ctx.db, ctx.actor, input.project, input.system, input.task))),

  /** Changes a task. */
  update: protectedProcedure
    .input(z.object({ ...TASK, patch: updateTaskInput }))
    .mutation(({ ctx, input }) => updateTask(ctx.db, ctx.actor, input.id, input.patch)),

  /** Deletes a task. */
  delete: protectedProcedure.input(z.object(TASK)).mutation(({ ctx, input }) => deleteTask(ctx.db, ctx.actor, input.id)),

  /** Puts a system's tasks into a new order. */
  reorder: protectedProcedure
    .input(z.object({ ...S, ...reorderTasksInput.shape }))
    .mutation(({ ctx, input }) => reorderTasks(ctx.db, ctx.actor, input.project, input.system, { orderedIds: input.orderedIds })),

  /** Moves a task to another system of its project. */
  move: protectedProcedure
    .input(z.object({ ...TASK, to: moveTaskInput }))
    .mutation(({ ctx, input }) => moveTask(ctx.db, ctx.actor, input.id, input.to)),

  /** Checklist items inside a task. */
  checks: router({
    add: protectedProcedure
      .input(z.object({ taskId: dbInt, check: addCheckInput }))
      .mutation(async ({ ctx, input }) => void (await addCheck(ctx.db, ctx.actor, input.taskId, input.check))),
    update: protectedProcedure
      .input(z.object({ ...CHECK, patch: updateCheckInput }))
      .mutation(({ ctx, input }) => updateCheck(ctx.db, ctx.actor, input.id, input.patch)),
    delete: protectedProcedure.input(z.object(CHECK)).mutation(({ ctx, input }) => deleteCheck(ctx.db, ctx.actor, input.id)),
  }),
});
