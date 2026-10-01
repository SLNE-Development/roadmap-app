import "server-only";
import { z } from "zod";
import { completeAreaInput, completePlanningArea, getPlanning, planningGapsFor, reopenAreaInput, reopenPlanning, reopenPlanningArea } from "@/lib/ops/planning";
import { listSystems } from "@/lib/ops/systems";
import { protectedProcedure, router } from "../init";
import { P, S } from "./shared";

/** The planning interview of systems. */
export const planningRouter = router({
  /** A system's planning rounds, confirmation and completion. */
  get: protectedProcedure.input(z.object(S)).query(({ ctx, input }) => getPlanning(ctx.db, ctx.actor, input.project, input.system)),

  /** What still blocks planning of every system in a planning column, keyed by system id. */
  gaps: protectedProcedure.input(z.object(P)).query(async ({ ctx, input }) => {
    const planning = (await listSystems(ctx.db, ctx.actor, input.project)).filter((s) => s.columnCategory === "planning");
    return Object.fromEntries(await planningGapsFor(ctx.db, planning.map((s) => s.id)));
  }),

  /** Reopens a system's planning. */
  reopen: protectedProcedure.input(z.object(S)).mutation(({ ctx, input }) => reopenPlanning(ctx.db, ctx.actor, input.project, input.system)),

  /** Reopens one planning area of a completed system. */
  reopenArea: protectedProcedure
    .input(z.object({ ...S, ...reopenAreaInput.shape }))
    .mutation(({ ctx, input: { project, system, ...input } }) => reopenPlanningArea(ctx.db, ctx.actor, project, system, input)),

  /** Closes a reopened planning area. */
  completeArea: protectedProcedure
    .input(z.object({ ...S, ...completeAreaInput.shape }))
    .mutation(({ ctx, input: { project, system, ...input } }) => completePlanningArea(ctx.db, ctx.actor, project, system, input)),
});
