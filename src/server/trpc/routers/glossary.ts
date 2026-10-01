import "server-only";
import { z } from "zod";
import { deleteGlossaryTerm, listGlossary, setGlossaryTerm, setGlossaryTermInput } from "@/lib/ops/glossary";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** A project's glossary. */
export const glossaryRouter = router({
  /** The project's glossary terms, by term. */
  list: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listGlossary(ctx.db, ctx.actor, input.project)),

  /** Adds a term or changes the one with the same term. */
  set: protectedProcedure
    .input(z.object({ ...P, ...setGlossaryTermInput.shape }))
    .mutation(({ ctx, input: { project, ...term } }) => setGlossaryTerm(ctx.db, ctx.actor, project, term)),

  /** Deletes a term. */
  delete: protectedProcedure
    .input(z.object({ ...P, term: z.string().min(1).max(60) }))
    .mutation(({ ctx, input }) => deleteGlossaryTerm(ctx.db, ctx.actor, input.project, input.term)),
});
