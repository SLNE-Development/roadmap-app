import { z } from "zod";
import { boardGates, listGateRules } from "@/lib/ops/gates";
import { protectedProcedure, router } from "../init";
import { B } from "./shared";

/** Column entry rules: what each system on a board still lacks for the next gated column. */
export const gatesRouter = router({
  /** The gate status of every system on the board, by system id. */
  board: protectedProcedure.input(z.object(B)).query(({ ctx, input }) => boardGates(ctx.db, ctx.actor, input.project, input.board)),

  /** The rules a column can require, for the rules editor. */
  rules: protectedProcedure.query(() => listGateRules()),
});
