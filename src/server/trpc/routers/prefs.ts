import "server-only";
import { z } from "zod";
import {
  deletePref,
  getPref,
  getPrefs,
  prefKeySchema,
  setPref,
} from "@/lib/ops/prefs";
import { protectedProcedure, router } from "../init";

/** The signed-in user's own preferences; every procedure acts on the actor alone. */
export const prefsRouter = router({
  /** One preference, or `null` when unset. */
  get: protectedProcedure
    .input(z.object({ key: prefKeySchema }))
    .query(({ ctx, input }) => getPref(ctx.db, ctx.actor.userId, input.key)),

  /** Every preference whose key starts with `prefix`, by key. */
  list: protectedProcedure
    .input(z.object({ prefix: z.string().max(128) }))
    .query(({ ctx, input }) =>
      getPrefs(ctx.db, ctx.actor.userId, input.prefix),
    ),

  /** Sets a preference. */
  set: protectedProcedure
    .input(z.object({ key: prefKeySchema, value: z.unknown() }))
    .mutation(({ ctx, input }) =>
      setPref(ctx.db, ctx.actor, input.key, input.value),
    ),

  /** Deletes a preference. */
  delete: protectedProcedure
    .input(z.object({ key: prefKeySchema }))
    .mutation(({ ctx, input }) => deletePref(ctx.db, ctx.actor, input.key)),
});
