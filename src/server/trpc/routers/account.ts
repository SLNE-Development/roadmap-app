import "server-only";
import { z } from "zod";
import { getAuth } from "@/lib/auth/server";
import { slugSchema } from "@/lib/ops/access";
import { createApiKeyInput, listApiKeys, revokeApiKey } from "@/lib/ops/api-keys";
import { addAllowedAccount, addAllowedAccountInput, listAllowedAccounts, listUsers, removeAllowedAccount, setAdmin } from "@/lib/ops/users";
import { protectedProcedure, router } from "../init";

/** The signed-in user, their API keys, and (for admins) the account allowlist. */
export const accountRouter = router({
  /** The signed-in actor. */
  me: protectedProcedure.query(({ ctx }) => ({ userId: ctx.actor.userId, name: ctx.actor.name, isAdmin: ctx.actor.isAdmin })),

  /** Every provisioned user, for the member picker. Project owners only. */
  users: protectedProcedure.input(z.object({ project: slugSchema })).query(({ ctx, input }) => listUsers(ctx.db, ctx.actor, input.project)),

  /** The actor's API keys, newest first; never the keys themselves. */
  apiKeys: protectedProcedure.query(({ ctx }) => listApiKeys(ctx.db, ctx.actor)),

  /** Creates an API key for the actor and returns the key, the only time it is shown. */
  createApiKey: protectedProcedure.input(createApiKeyInput).mutation(async ({ ctx, input }) => {
    const created = await getAuth().api.createApiKey({
      body: { name: input.name, expiresIn: input.expiresInDays ? input.expiresInDays * 86_400 : null, userId: ctx.actor.userId },
    });
    return { key: created.key };
  }),

  /** Revokes one of the actor's keys. */
  revokeApiKey: protectedProcedure.input(z.object({ id: z.string().min(1) })).mutation(({ ctx, input }) => revokeApiKey(ctx.db, ctx.actor, input.id)),

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
