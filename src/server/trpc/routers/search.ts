import "server-only";
import { z } from "zod";
import { searchProject, searchProjectInput } from "@/lib/ops/search";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** Full-text search inside a project's documents. */
export const searchRouter = router({
  /** Hits in the project's systems, latest specs and plans, ADRs, pages and questions, best first. */
  project: protectedProcedure
    .input(z.object({ ...P, ...searchProjectInput.shape }))
    .query(({ ctx, input: { project, ...query } }) => searchProject(ctx.db, ctx.actor, project, query)),
});
