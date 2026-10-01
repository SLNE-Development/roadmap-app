import "server-only";
import { z } from "zod";
import { getRun, listProjectRuns, systemAgentCost } from "@/lib/ops/agent-runs";
import { protectedProcedure, router } from "../init";
import { P, S } from "./shared";

/** Agent runs: the project's list, one run's timeline and the cost per system. */
export const agentsRouter = router({
  /** The project's runs, newest first; all of them without `state`. */
  runs: protectedProcedure
    .input(z.object({ ...P, state: z.enum(["live", "recent", "failed"]).optional() }))
    .query(({ ctx, input }) => listProjectRuns(ctx.db, ctx.actor, input.project, { state: input.state })),

  /** One run with its calls in the project and the changes made meanwhile. */
  run: protectedProcedure
    .input(z.object({ ...P, runId: z.string().min(1).max(64) }))
    .query(({ ctx, input }) => getRun(ctx.db, ctx.actor, input.project, input.runId)),

  /** Tokens agents spent on a system, or `null` when no run reported usage. */
  systemCost: protectedProcedure.input(z.object(S)).query(({ ctx, input }) => systemAgentCost(ctx.db, ctx.actor, input.project, input.system)),
});
