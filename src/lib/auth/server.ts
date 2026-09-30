import "server-only";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { account, apikey, session, user, verification } from "@/db/schema";
import type { Db } from "@/db/types";
import { isAllowed, linkDiscordAccount } from "@/lib/ops/users";

/** Message shown when a Discord account that was not provisioned tries to sign in. */
export const NOT_PROVISIONED = "Your Discord account has not been added. Ask an admin.";

/**
 * Returns the value of a required environment variable.
 *
 * @throws Error naming the variable when it is unset or empty
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; see .env.example.`);
  return value;
}

/**
 * Returns the Discord id of a user, first linking it from their Discord account
 * row. Better Auth drops `input: false` fields from provider profiles, so the
 * account row is where the id arrives.
 */
async function discordIdOf(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, userId)).limit(1);
  if (row?.discordId) return row.discordId;
  const [linked] = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "discord")))
    .limit(1);
  if (!linked) return null;
  await linkDiscordAccount(db, userId, linked.accountId);
  const [after] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, userId)).limit(1);
  return after?.discordId ?? null;
}

/**
 * Builds the Better Auth instance: Discord sign-in for provisioned accounts,
 * the first account as admin, and per-user API keys with the `rmk_` prefix.
 */
function createAuth() {
  const db = getDb();
  return betterAuth({
    baseURL: requireEnv("BETTER_AUTH_URL"),
    secret: requireEnv("BETTER_AUTH_SECRET"),
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification, apikey } }),
    socialProviders: {
      discord: {
        clientId: requireEnv("DISCORD_CLIENT_ID"),
        clientSecret: requireEnv("DISCORD_CLIENT_SECRET"),
      },
    },
    user: {
      additionalFields: {
        discordId: { type: "string", required: false, input: false },
        isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (data) => {
            const discordId = await discordIdOf(db, data.userId);
            if (!discordId || !(await isAllowed(db, discordId))) {
              throw new APIError("FORBIDDEN", { message: NOT_PROVISIONED });
            }
          },
        },
      },
    },
    plugins: [apiKey({ defaultPrefix: "rmk_", rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 600 } }), nextCookies()],
  });
}

/** The configured Better Auth instance. */
export type Auth = ReturnType<typeof createAuth>;

/** Lazily created instance, so builds without environment variables do not fail. */
let cached: Auth | undefined;

/** Returns the Better Auth instance, creating it on first use. */
export function getAuth(): Auth {
  cached ??= createAuth();
  return cached;
}
