import "server-only";
import { z } from "zod";
import { AUTH_EVENT_KINDS } from "@/db/schema";
import { setEventRole } from "@/lib/ops/users";
import { failedToolCalls, keyUsageOverview, listAuditEvents } from "@/lib/ops/audit";
import { protectedProcedure, router } from "../init";

/** The admin audit view: auth events, failed agent tool calls and API key usage. Admin only. */
export const adminRouter = router({
  /** Auth events, newest first, a page at a time; `cursor` is the previous page's `nextBefore`. */
  auditEvents: protectedProcedure
    .input(
      z.object({
        kind: z.enum(AUTH_EVENT_KINDS).optional(),
        userId: z.string().min(1).optional(),
        cursor: z.number().int().positive().nullish(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
    )
    .query(({ ctx, input: { cursor, ...filter } }) => listAuditEvents(ctx.db, ctx.actor, { ...filter, before: cursor ?? undefined })),

  /** Failed agent tool calls of the last days, newest first. */
  failedCalls: protectedProcedure
    .input(z.object({ days: z.number().int().min(1).max(30).optional(), limit: z.number().int().min(1).max(500).optional() }))
    .query(({ ctx, input }) => failedToolCalls(ctx.db, ctx.actor, input)),

  /** Every API key with its owner and use over the last 30 days. */
  keyUsage: protectedProcedure.query(({ ctx }) => keyUsageOverview(ctx.db, ctx.actor)),

  /** Grants or revokes the event manager or event developer flag of a user. */
  setEventRole: protectedProcedure
    .input(z.object({ userId: z.string().min(1), role: z.enum(["manager", "developer"]), value: z.boolean() }))
    .mutation(({ ctx, input }) => setEventRole(ctx.db, ctx.actor, input.userId, input.role, input.value)),
});
