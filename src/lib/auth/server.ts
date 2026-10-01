import "server-only";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { account, apikey, session, user, verification } from "@/db/schema";
import type { Db } from "@/db/types";
import { recordAuthEvent } from "@/lib/ops/audit";
import { isAllowed, linkDiscordAccount } from "@/lib/ops/users";
import { API_KEY_RATE_LIMIT } from "./rate-limit";

/** Message shown when a Discord account that was not provisioned tries to sign in. */
export const NOT_PROVISIONED = "Your Discord account has not been added. Ask an admin.";

/**
 * Error code of a sign-in refused by the allowlist. The OAuth callback turns an
 * `APIError` carrying a `code` into a redirect to the error URL with
 * `?error=<code>&error_description=<message>`; without a code the error would
 * surface as a bare 403 JSON response.
 */
export const NOT_PROVISIONED_CODE = "NOT_PROVISIONED";

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

/** The auth event fields a session row carries: its user, address and user agent. */
function sessionEvent(data: { userId: string; ipAddress?: string | null; userAgent?: string | null }) {
  return { userId: data.userId, discordId: null, apiKeyId: null, ip: data.ipAddress ?? null, userAgent: data.userAgent ?? null, detail: null };
}

/** Better Auth's own API key endpoints; keys are managed through the app's tRPC procedures instead. */
export const BLOCKED_AUTH_PATH = /^\/api-key\//;

/**
 * Returns whether an auth endpoint call must be refused: the API key endpoints
 * are closed to HTTP requests, while server-side `auth.api.*` calls (which carry
 * no request) keep working.
 */
export function isBlockedAuthRequest(path: string, hasRequest: boolean): boolean {
  return hasRequest && BLOCKED_AUTH_PATH.test(path);
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
    // No `session.cookieCache`: deleting a session row must sign that device out at once; a cache would delay sign-outs.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (isBlockedAuthRequest(ctx.path, !!ctx.request)) throw new APIError("NOT_FOUND");
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (data) => {
            const discordId = await discordIdOf(db, data.userId);
            if (!discordId || !(await isAllowed(db, discordId))) {
              await recordAuthEvent(db, { ...sessionEvent(data), kind: "sign-in-refused", discordId });
              throw new APIError("FORBIDDEN", { code: NOT_PROVISIONED_CODE, message: NOT_PROVISIONED });
            }
          },
          after: async (data) => {
            await recordAuthEvent(db, { ...sessionEvent(data), kind: "sign-in" });
          },
        },
        // Fires for Better Auth's own deletes (sign-out, expiry); the sessions page deletes rows itself and records there.
        delete: {
          after: async (data, ctx) => {
            await recordAuthEvent(db, { ...sessionEvent(data), kind: "session-ended", detail: ctx?.path === "/sign-out" ? "Signed out" : null });
          },
        },
      },
    },
    plugins: [apiKey({ defaultPrefix: "rmk_", rateLimit: { enabled: true, ...API_KEY_RATE_LIMIT } }), nextCookies()],
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
