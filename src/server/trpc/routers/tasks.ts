import "server-only";
import { z } from "zod";
import { addTask, addTaskInput, deleteTask, updateTask, updateTaskInput } from "@/lib/ops/tasks";
import { protectedProcedure, router } from "../init";
import { S } from "./shared";

/** A task by its id. */
const TASK = { id: z.number().int().positive() };

/** Tasks of a system; they are read through `systems.overview`. */
export const tasksRouter = router({
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
});
