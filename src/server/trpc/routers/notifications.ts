import "server-only";
import { z } from "zod";
import { listMentionMembers } from "@/lib/ops/mentions";
import { listNotifications, listNotificationsInput, markAllRead, markRead, unreadCount } from "@/lib/ops/notifications";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** The signed-in user's inbox, and the members a mention can name. */
export const notificationsRouter = router({
  /** The inbox, newest first; `cursor` (for infinite queries) takes the place of `before`. */
  list: protectedProcedure
    .input(listNotificationsInput.extend({ cursor: z.string().min(1).nullish() }))
    .query(({ ctx, input: { cursor, ...input } }) => listNotifications(ctx.db, ctx.actor, { ...input, before: cursor ?? input.before })),

  /** How many inbox rows are unread, capped at 100 (shown as 99+). */
  unread: protectedProcedure.query(({ ctx }) => unreadCount(ctx.db, ctx.actor)),

  /** Marks the given rows read; other users' rows are ignored. */
  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(100) }))
    .mutation(({ ctx, input }) => markRead(ctx.db, ctx.actor, input.ids)),

  /** Marks every unread row read. */
  markAllRead: protectedProcedure.mutation(({ ctx }) => markAllRead(ctx.db, ctx.actor)),

  /** The project's members, for the mention picker. */
  members: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listMentionMembers(ctx.db, ctx.actor, input.project)),
});
