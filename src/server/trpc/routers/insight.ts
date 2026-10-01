import "server-only";
import { z } from "zod";
import { columnTimesInput, getColumnTimes, getProgress, progressInput } from "@/lib/ops/insight";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** Charts over a project's history. */
export const insightRouter = router({
  /** The task burn-up and projected finish, optionally narrowed to a phase, board, domain or release. */
  progress: protectedProcedure
    .input(z.object({ ...P, filter: progressInput.optional() }))
    .query(({ ctx, input: { project, filter } }) => getProgress(ctx.db, ctx.actor, project, filter ?? {})),
  /** Time each system spent in each column category, and the median per category. */
  columnTimes: protectedProcedure
    .input(z.object({ ...P, filter: columnTimesInput.optional() }))
    .query(({ ctx, input: { project, filter } }) => getColumnTimes(ctx.db, ctx.actor, project, filter ?? {})),
});
