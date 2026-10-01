import "server-only";
import { z } from "zod";
import { boardPresence, systemPresence } from "@/lib/ops/presence";
import { protectedProcedure, router } from "../init";
import { B, S } from "./shared";

/** Who is viewing a system and which agents are working on it. */
export const presenceRouter = router({
  system: protectedProcedure
    .input(z.object(S))
    .query(({ ctx, input }) => systemPresence(ctx.db, ctx.kv, ctx.actor, input, new Date())),
  board: protectedProcedure
    .input(z.object(B))
    .query(({ ctx, input }) => boardPresence(ctx.db, ctx.kv, ctx.actor, input, new Date())),
});
