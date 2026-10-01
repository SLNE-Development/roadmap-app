import "server-only";
import { z } from "zod";
import { projectAccess } from "@/lib/ops/access";
import { createSavedView, deleteSavedView, listSavedViews, renameSavedView, reorderSavedViews, savedViewInput, setSavedViewPinned } from "@/lib/ops/saved-views";
import { protectedProcedure, router } from "../init";

/** The signed-in user's own saved views; every procedure acts on the actor alone. */
export const viewsRouter = router({
  /** The actor's views, or with `project` that project's plus the global ones. */
  list: protectedProcedure.input(z.object({ project: z.string().optional() })).query(async ({ ctx, input }) => {
    const projectId = input.project ? (await projectAccess(ctx.db, ctx.actor, input.project, "viewer")).project.id : undefined;
    return listSavedViews(ctx.db, ctx.actor, { projectId });
  }),

  /** Saves a view, pinned. */
  create: protectedProcedure.input(savedViewInput).mutation(({ ctx, input }) => createSavedView(ctx.db, ctx.actor, input)),

  /** Renames a view. */
  rename: protectedProcedure
    .input(z.object({ id: z.string().min(1), name: savedViewInput.shape.name }))
    .mutation(({ ctx, input }) => renameSavedView(ctx.db, ctx.actor, input.id, input.name)),

  /** Deletes a view. */
  delete: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(({ ctx, input }) => deleteSavedView(ctx.db, ctx.actor, input.id)),

  /** Puts the given views first, in order. */
  reorder: protectedProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).max(100) }))
    .mutation(({ ctx, input }) => reorderSavedViews(ctx.db, ctx.actor, input.ids)),

  /** Pins a view to the sidebar or unpins it. */
  setPinned: protectedProcedure
    .input(z.object({ id: z.string().min(1), pinned: z.boolean() }))
    .mutation(({ ctx, input }) => setSavedViewPinned(ctx.db, ctx.actor, input.id, input.pinned)),
});
