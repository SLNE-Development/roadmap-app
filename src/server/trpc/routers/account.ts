import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { user } from "@/db/schema";
import { LOCALES, resolveTimeZone } from "@/i18n/locale";
import { requestClient } from "@/lib/auth/actor";
import { getAuth } from "@/lib/auth/server";
import { slugSchema } from "@/lib/ops/access";
import type { Actor } from "@/lib/ops/actor";
import { recordAuthEvent, type AuthEventInput } from "@/lib/ops/audit";
import { InvalidError } from "@/lib/ops/errors";
import { endOtherSessions, endSession, listSessions } from "@/lib/ops/sessions";
import { setPref } from "@/lib/ops/prefs";
import { requestRights } from "@/lib/ops/requests";
import { myWork, myWorkSeenAt, markMyWorkSeen } from "@/lib/ops/my-work";
import { createApiKeyInput, listApiKeys, revokeApiKey, rotateApiKey } from "@/lib/ops/api-keys";
import { addAllowedAccount, addAllowedAccountInput, listAllowedAccounts, listUsers, removeAllowedAccount, setAdmin } from "@/lib/ops/users";
import { teamWorkload, workloadProjects } from "@/lib/ops/workload";
import { plural } from "@/lib/text";
import { protectedProcedure, router, type Context } from "../init";

/** Records an auth event of the actor with the request's address and user agent; never throws. */
async function audit(ctx: Context & { actor: Actor }, event: Pick<AuthEventInput, "kind"> & Partial<AuthEventInput>): Promise<void> {
  let client: { ip: string | null; userAgent: string | null } = { ip: null, userAgent: null };
  try {
    client = await requestClient();
  } catch {
    // Outside a request (server-side callers in tests) there are no headers to read.
  }
  await recordAuthEvent(ctx.db, { userId: ctx.actor.userId, discordId: null, apiKeyId: null, detail: null, ...client, ...event });
}

/** The signed-in user, their API keys, and (for admins) the account allowlist. */
export const accountRouter = router({
  /** The signed-in actor. */
  me: protectedProcedure.query(async ({ ctx }) => ({
    userId: ctx.actor.userId,
    name: ctx.actor.name,
    isAdmin: ctx.actor.isAdmin,
    ...(await requestRights(ctx.db, ctx.actor)),
  })),

  /** The actor's own Discord id, or null while their account has none; admins show it under their profile menu. */
  discordId: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db.select({ discordId: user.discordId }).from(user).where(eq(user.id, ctx.actor.userId)).limit(1);
    return { discordId: row?.discordId ?? null };
  }),

  /** What is waiting on the actor across their projects and what changed since they last marked it seen. */
  myWork: protectedProcedure.query(async ({ ctx }) => {
    const [items, seenAt] = await Promise.all([myWork(ctx.db, ctx.actor, { now: new Date() }), myWorkSeenAt(ctx.db, ctx.actor)]);
    return { items, seenAt };
  }),

  /** Marks the actor's changes as seen now. */
  markMyWorkSeen: protectedProcedure.mutation(({ ctx }) => markMyWorkSeen(ctx.db, ctx.actor, new Date())),

  /** The workload of everyone in the actor's projects, optionally of one project the actor belongs to. */
  workload: protectedProcedure
    .input(z.object({ project: slugSchema.optional() }))
    .query(({ ctx, input }) => teamWorkload(ctx.db, ctx.actor, { project: input.project })),

  /** The projects the workload page can be narrowed to: those the actor is an active member of. */
  workloadProjects: protectedProcedure.query(({ ctx }) => workloadProjects(ctx.db, ctx.actor)),

  /** Every provisioned user, for the member picker. Project owners only. */
  users: protectedProcedure.input(z.object({ project: slugSchema })).query(({ ctx, input }) => listUsers(ctx.db, ctx.actor, input.project)),

  /** The actor's API keys, newest first; never the keys themselves. */
  apiKeys: protectedProcedure.query(({ ctx }) => listApiKeys(ctx.db, ctx.actor)),

  /** Creates an API key for the actor and returns the key, the only time it is shown. */
  createApiKey: protectedProcedure.input(createApiKeyInput).mutation(async ({ ctx, input }) => {
    const created = await getAuth().api.createApiKey({
      body: { name: input.name, expiresIn: input.expiresInDays ? input.expiresInDays * 86_400 : null, userId: ctx.actor.userId },
    });
    await audit(ctx, { kind: "key-created", apiKeyId: created.id, detail: input.name });
    return { key: created.key };
  }),

  /** Revokes one of the actor's keys. */
  revokeApiKey: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    await revokeApiKey(ctx.db, ctx.actor, input.id);
    await audit(ctx, { kind: "key-revoked", apiKeyId: input.id });
  }),

  /** Replaces a key by a new one with the same name; the old key works for 24 more hours. Returns the new key, shown once. */
  rotateApiKey: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      let newId: string | undefined;
      const result = await rotateApiKey(ctx.db, ctx.actor, input.id, async (body) => {
        const created = await getAuth().api.createApiKey({ body });
        newId = created.id;
        return { key: created.key, id: created.id };
      });
      await audit(ctx, { kind: "key-rotated", apiKeyId: input.id, detail: newId ? `Replaced by ${newId}` : null });
      return result;
    }),

  /** The actor's signed-in sessions, the current one first. */
  sessions: protectedProcedure.query(({ ctx }) => listSessions(ctx.db, ctx.actor, ctx.sessionId)),

  /** Signs one of the actor's other sessions out; the current one ends through Sign out. */
  endSession: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(async ({ ctx, input }) => {
    if (input.id === ctx.sessionId) throw new InvalidError("Use Sign out to end this session.");
    await endSession(ctx.db, ctx.actor, input.id);
    await audit(ctx, { kind: "session-ended", detail: `Session ${input.id} signed out from another session` });
  }),

  /** Signs the actor out of every session except the current one. */
  endOtherSessions: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await endOtherSessions(ctx.db, ctx.actor, ctx.sessionId);
    if (result.ended > 0) await audit(ctx, { kind: "session-ended", detail: `${plural(result.ended, "other session")} signed out` });
    return result;
  }),

  /** Sets the actor's UI language. */
  setLocale: protectedProcedure
    .input(z.object({ locale: z.enum(LOCALES) }))
    .mutation(({ ctx, input }) => setPref(ctx.db, ctx.actor, "locale", input.locale)),

  /** Sets the time zone the actor's times are shown in; unknown zones are refused. */
  setTimeZone: protectedProcedure.input(z.object({ timeZone: z.string().min(1).max(64) })).mutation(({ ctx, input }) => {
    if (resolveTimeZone(input.timeZone) !== input.timeZone) throw new InvalidError("Unknown time zone.");
    return setPref(ctx.db, ctx.actor, "timeZone", input.timeZone);
  }),

  /** The provisioned Discord accounts. Admin only. */
  accounts: protectedProcedure.query(({ ctx }) => listAllowedAccounts(ctx.db, ctx.actor)),

  /** Provisions a Discord account. Admin only. */
  addAccount: protectedProcedure.input(addAllowedAccountInput).mutation(({ ctx, input }) => addAllowedAccount(ctx.db, ctx.actor, input)),

  /** Removes a provisioned account, ending its sessions and keys. Admin only. */
  removeAccount: protectedProcedure
    .input(z.object({ discordId: z.string().min(1) }))
    .mutation(({ ctx, input }) => removeAllowedAccount(ctx.db, ctx.actor, input.discordId)),

  /** Grants or revokes admin. Admin only. */
  setAdmin: protectedProcedure
    .input(z.object({ userId: z.string().min(1), isAdmin: z.boolean() }))
    .mutation(({ ctx, input }) => setAdmin(ctx.db, ctx.actor, input.userId, input.isAdmin)),
});
