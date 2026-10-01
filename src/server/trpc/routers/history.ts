import "server-only";
import { z } from "zod";
import { DOCUMENT_KINDS } from "@/db/schema";
import { activityFilter, listActivity } from "@/lib/ops/activity";
import { compareDocuments, getDocument } from "@/lib/ops/documents";
import { dbInt } from "@/lib/ops/params";
import { listUpdates, listUpdatesInput } from "@/lib/ops/updates";
import { protectedProcedure, router } from "../init";
import { P, S } from "./shared";

/** Progress updates, the change log and document versions. */
export const historyRouter = router({
  /** Progress updates of the project or one system, newest first; `cursor` is the oldest id shown so far (`before`). */
  updates: protectedProcedure
    .input(z.object({ ...P, filter: listUpdatesInput.partial().optional(), cursor: z.string().min(1).nullish() }))
    .query(({ ctx, input }) =>
      listUpdates(ctx.db, ctx.actor, input.project, input.cursor ? { ...input.filter, before: input.cursor } : input.filter),
    ),

  /** Changes of the project or one system, newest first; `cursor` is the oldest id shown so far (`before`). */
  activity: protectedProcedure
    .input(z.object({ ...P, filter: activityFilter.partial().optional(), cursor: z.number().int().positive().nullish() }))
    .query(({ ctx, input }) =>
      listActivity(ctx.db, ctx.actor, input.project, input.cursor ? { ...input.filter, before: input.cursor } : input.filter),
    ),

  /** A version of a system's spec or plan, the latest without `version`; `null` when none exists. */
  document: protectedProcedure
    .input(z.object({ ...S, kind: z.enum(DOCUMENT_KINDS), version: dbInt.optional() }))
    .query(({ ctx, input }) => getDocument(ctx.db, ctx.actor, input.project, input.system, input.kind, input.version)),

  /** The line differences between two versions of a system's spec or plan. */
  compare: protectedProcedure
    .input(z.object({ ...S, kind: z.enum(DOCUMENT_KINDS), from: dbInt, to: dbInt }))
    .query(({ ctx, input }) => compareDocuments(ctx.db, ctx.actor, input.project, input.system, input.kind, input.from, input.to)),
});
