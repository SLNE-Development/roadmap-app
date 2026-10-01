import "server-only";
import { z } from "zod";
import { dbInt } from "@/lib/ops/params";
import { comparePages, deletePage, getPage, listPages, writePageInput, writePage } from "@/lib/ops/pages";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** The project and page a procedure acts on. */
const PG = { ...P, page: z.string().min(1).max(64) };

/** A project's pages and their versions. */
export const pagesRouter = router({
  /** The project's pages with their latest version. */
  list: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listPages(ctx.db, ctx.actor, input.project)),

  /** A version of a page, the latest without `version`. */
  get: protectedProcedure
    .input(z.object({ ...PG, version: dbInt.optional() }))
    .query(({ ctx, input }) => getPage(ctx.db, ctx.actor, input.project, input.page, input.version)),

  /** The line differences between two versions of a page. */
  compare: protectedProcedure
    .input(z.object({ ...PG, from: dbInt, to: dbInt }))
    .query(({ ctx, input }) => comparePages(ctx.db, ctx.actor, input.project, input.page, input.from, input.to)),

  /** Creates a page or writes its next version. */
  write: protectedProcedure
    .input(z.object({ ...P, ...writePageInput.shape }))
    .mutation(({ ctx, input: { project, ...page } }) => writePage(ctx.db, ctx.actor, project, page)),

  /** Deletes a page with all its versions. */
  delete: protectedProcedure.input(z.object(PG)).mutation(({ ctx, input }) => deletePage(ctx.db, ctx.actor, input.project, input.page)),
});
