import "server-only";
import { z } from "zod";
import { QUESTION_PRIORITIES } from "@/db/schema";
import { addQuestion, addQuestionInput, answerQuestion, answerQuestionInput, listQuestions, questionFilter, setQuestionPriority, setQuestionResolved } from "@/lib/ops/questions";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** Open questions of a project. */
export const questionsRouter = router({
  /** The project's questions matching the filter, unresolved first, then newest first. */
  list: protectedProcedure
    .input(z.object({ ...P, filter: questionFilter.optional() }))
    .query(({ ctx, input }) => listQuestions(ctx.db, ctx.actor, input.project, input.filter)),

  /** Adds an open question. */
  add: protectedProcedure
    .input(z.object({ ...P, question: addQuestionInput }))
    .mutation(async ({ ctx, input }) => void (await addQuestion(ctx.db, ctx.actor, input.project, input.question))),

  /** Answers a question. */
  answer: protectedProcedure
    .input(z.object({ ...P, answer: answerQuestionInput }))
    .mutation(({ ctx, input }) => answerQuestion(ctx.db, ctx.actor, input.project, input.answer)),

  /** Marks a question resolved or unresolved. */
  setResolved: protectedProcedure
    .input(z.object({ ...P, id: z.string().min(1), resolved: z.boolean() }))
    .mutation(({ ctx, input }) => setQuestionResolved(ctx.db, ctx.actor, input.project, input.id, input.resolved)),

  /** Sets a question's priority. */
  setPriority: protectedProcedure
    .input(z.object({ ...P, id: z.string().min(1), priority: z.enum(QUESTION_PRIORITIES) }))
    .mutation(({ ctx, input }) => setQuestionPriority(ctx.db, ctx.actor, input.project, input.id, input.priority)),
});
