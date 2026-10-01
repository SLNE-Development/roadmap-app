import "server-only";
import { z } from "zod";
import { boardGates, listGateRules } from "@/lib/ops/gates";
import "@/lib/ops/github-links";
import { listLinkedRepos, repoLinkStatus } from "@/lib/ops/github-repos";
import { protectedProcedure, router } from "../init";
import { B, P } from "./shared";

/** Column entry rules: what each system on a board still lacks for the next gated column. */
export const gatesRouter = router({
  /** The gate status of every system on the board, by system id. */
  board: protectedProcedure.input(z.object(B)).query(({ ctx, input }) => boardGates(ctx.db, ctx.actor, input.project, input.board)),

  /** The rules a column can require, for the rules editor; rules that need GitHub are hidden until an App or a linked repository exists, except those in `include`. */
  rules: protectedProcedure.input(z.object({ ...P, include: z.array(z.string()).optional() })).query(async ({ ctx, input }) => {
    const [status, repos] = await Promise.all([repoLinkStatus(ctx.db, ctx.actor, input.project), listLinkedRepos(ctx.db, ctx.actor, input.project)]);
    const github = status.appConfigured || repos.length > 0;
    // Rules the column already has stay listed, so saving never drops them.
    return listGateRules().filter((r) => github || !r.needsGithub || input.include?.includes(r.id));
  }),
});
