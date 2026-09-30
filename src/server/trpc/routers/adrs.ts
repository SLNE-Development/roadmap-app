import "server-only";
import { z } from "zod";
import { acceptAdr, adrFilter, getAdr, listAdrs } from "@/lib/ops/adrs";
import { dbInt } from "@/lib/ops/params";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** An ADR by its number within the project. */
const ADR = { ...P, number: dbInt };

/** Architecture decision records. */
export const adrsRouter = router({
  /** The project's ADRs matching the filter. */
  list: protectedProcedure
    .input(z.object({ ...P, filter: adrFilter.optional() }))
    .query(({ ctx, input }) => listAdrs(ctx.db, ctx.actor, input.project, input.filter)),

  /** One ADR with its full text. */
  get: protectedProcedure.input(z.object(ADR)).query(({ ctx, input }) => getAdr(ctx.db, ctx.actor, input.project, input.number)),

  /** Accepts a proposed ADR. */
  accept: protectedProcedure.input(z.object(ADR)).mutation(({ ctx, input }) => acceptAdr(ctx.db, ctx.actor, input.project, input.number)),
});
