import "server-only";
import { z } from "zod";
import { ACTIVE_TTL_SECONDS, activeKey, NOTIFY_RULES_PREF, notifyRulesSchema } from "@/lib/notify-rules-schema";
import { listMentionMembers } from "@/lib/ops/mentions";
import { listNotifications, listNotificationsInput, markAllRead, markRead, unreadCount } from "@/lib/ops/notifications";
import { readNotifyRules } from "@/lib/ops/notify-rules";
import { setPref } from "@/lib/ops/prefs";
import { listDevices, sendTestPush, subscribePush, subscribePushInput, unsubscribePush } from "@/lib/ops/push";
import { pushConfig } from "@/lib/push-config";
import { bullQueue, QUEUE } from "@/lib/queue";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

const deviceId = z.object({ id: z.string().min(1).max(64) });

/** The signed-in user's inbox, notification rules and push devices, and the members a mention can name. */
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

  /** The signed-in user's notification rules, merged over the defaults. */
  rules: protectedProcedure.query(({ ctx }) => readNotifyRules(ctx.db, ctx.actor.userId)),

  /** Saves the full rules object as the user's preference. */
  setRules: protectedProcedure.input(notifyRulesSchema).mutation(async ({ ctx, input }) => {
    await setPref(ctx.db, ctx.actor, NOTIFY_RULES_PREF, input);
  }),

  /** Marks the user as active for a while, so pushes are held back; a down key-value store is ignored. */
  heartbeat: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      await ctx.kv.set(activeKey(ctx.actor.userId), "1", ACTIVE_TTL_SECONDS);
    } catch {
      // Web requests never wait on Valkey to finish.
    }
  }),

  /** The VAPID public key browsers subscribe with; null when push is not set up. */
  pushKey: protectedProcedure.query(() => pushConfig()?.publicKey ?? null),

  /** Saves this browser's push subscription for the signed-in user. */
  subscribe: protectedProcedure.input(subscribePushInput).mutation(({ ctx, input }) => subscribePush(ctx.db, ctx.actor, input)),

  /** Removes one of the user's devices. */
  unsubscribe: protectedProcedure.input(deviceId).mutation(({ ctx, input }) => unsubscribePush(ctx.db, ctx.actor, input.id)),

  /** The user's devices, without endpoints or keys. */
  devices: protectedProcedure.query(({ ctx }) => listDevices(ctx.db, ctx.actor)),

  /** Queues a test push to one of the user's devices. */
  testPush: protectedProcedure.input(deviceId).mutation(({ ctx, input }) => sendTestPush(ctx.db, ctx.actor, input.id, bullQueue(QUEUE.deliver))),
});
