import "server-only";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { account, allowedAccount, apikey, session, user, verification } from "@/db/schema";
import { checkSignIn, isAllowed } from "@/lib/ops/users";

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
        mapProfileToUser: (profile) => ({ discordId: profile.id }),
      },
    },
    user: {
      additionalFields: {
        discordId: { type: "string", required: false, input: false },
        isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (data) => {
            const verdict = await checkSignIn(db, String(data.discordId ?? ""));
            if (verdict === "rejected") throw new APIError("FORBIDDEN", { message: NOT_PROVISIONED });
            return { data: { ...data, isAdmin: verdict === "first-user" } };
          },
          after: async (created) => {
            if (created.isAdmin && created.discordId) {
              await db
                .insert(allowedAccount)
                .values({ discordId: String(created.discordId), displayName: created.name })
                .onConflictDoNothing();
            }
          },
        },
      },
      session: {
        create: {
          before: async (data) => {
            const [row] = await db.select({ discordId: user.discordId }).from(user).where(eq(user.id, data.userId)).limit(1);
            if (!row?.discordId || !(await isAllowed(db, row.discordId))) {
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
