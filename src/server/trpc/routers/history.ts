import "server-only";
import { z } from "zod";
import { DOCUMENT_KINDS } from "@/db/schema";
import { activityFilter, listActivity } from "@/lib/ops/activity";
import { getDocument } from "@/lib/ops/documents";
import { listUpdates, listUpdatesInput } from "@/lib/ops/updates";
import { protectedProcedure, router } from "../init";
import { P, S } from "./shared";

/** Progress updates, the change log and document versions. */
export const historyRouter = router({
  /** Progress updates of the project or one system, newest first. */
  updates: protectedProcedure
    .input(z.object({ ...P, filter: listUpdatesInput.partial().optional() }))
    .query(({ ctx, input }) => listUpdates(ctx.db, ctx.actor, input.project, input.filter)),

  /** Changes of the project or one system, newest first. */
  activity: protectedProcedure
    .input(z.object({ ...P, filter: activityFilter.partial().optional() }))
    .query(({ ctx, input }) => listActivity(ctx.db, ctx.actor, input.project, input.filter)),

  /** A version of a system's spec or plan, the latest without `version`; `null` when none exists. */
  document: protectedProcedure
    .input(z.object({ ...S, kind: z.enum(DOCUMENT_KINDS), version: z.number().int().positive().optional() }))
    .query(({ ctx, input }) => getDocument(ctx.db, ctx.actor, input.project, input.system, input.kind, input.version)),
});
