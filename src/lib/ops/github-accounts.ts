import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { githubAccount } from "@/db/schema";
import type { Db } from "@/db/types";
import type { GitHubApi } from "@/lib/github/api";
import type { Kv } from "@/lib/kv";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, isUniqueViolation } from "./errors";
import { loadAppConfig } from "./github-app";

/** How long an OAuth state is valid, in seconds. */
const STATE_TTL = 600;

/**
 * Starts linking the actor's GitHub login: stores a single-use state and returns GitHub's authorize URL.
 *
 * @throws ConflictError when no GitHub App is configured
 */
export async function startGitHubLink(db: Db, kv: Kv, actor: Actor): Promise<{ url: string }> {
  const app = await loadAppConfig(db);
  if (!app) throw new ConflictError("The GitHub App is not set up yet.");
  const state = randomBytes(32).toString("hex");
  await kv.set(`gh:oauth:${state}`, actor.userId, STATE_TTL);
  return {
    url: `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(app.clientId)}&state=${state}&allow_signup=false`,
  };
}

/**
 * Finishes linking after GitHub's redirect: checks that the state belongs to the user, exchanges the code and
 * stores the GitHub login. Linking again updates the login.
 *
 * @throws ForbiddenError when the state is unknown, expired, used or another user's
 * @throws ConflictError when the GitHub account is linked to another person
 */
export async function completeGitHubLink(db: Db, kv: Kv, api: GitHubApi, userId: string, code: string, state: string): Promise<void> {
  const key = `gh:oauth:${state}`;
  const owner = await kv.get(key);
  // Single use: the state is gone before the exchange, whatever follows.
  if (owner) await kv.del(key);
  if (owner !== userId) throw new ForbiddenError("The GitHub sign-in did not start here. Try connecting again.");
  const gh = await api.exchangeOAuthCode(code);
  const taken = new ConflictError("That GitHub account is linked to another person.");
  const [existing] = await db.select({ userId: githubAccount.userId }).from(githubAccount).where(eq(githubAccount.githubId, gh.id));
  if (existing && existing.userId !== userId) throw taken;
  try {
    await db
      .insert(githubAccount)
      .values({ userId, githubId: gh.id, login: gh.login })
      .onConflictDoUpdate({ target: githubAccount.userId, set: { githubId: gh.id, login: gh.login, linkedAt: new Date() } });
  } catch (error) {
    if (isUniqueViolation(error)) throw taken;
    throw error;
  }
}

/** Drops an OAuth state the user abandoned at GitHub, so it cannot be used afterwards. */
export async function cancelGitHubLink(kv: Kv, state: string | null): Promise<void> {
  if (state) await kv.del(`gh:oauth:${state}`);
}

/** Removes the actor's linked GitHub login, if any. */
export async function unlinkGitHub(db: Db, actor: Actor): Promise<void> {
  await db.delete(githubAccount).where(eq(githubAccount.userId, actor.userId));
}

/** Returns the actor's linked GitHub login, or null. */
export async function myGitHubAccount(db: Db, actor: Actor): Promise<{ login: string; linkedAt: Date } | null> {
  const [row] = await db
    .select({ login: githubAccount.login, linkedAt: githubAccount.linkedAt })
    .from(githubAccount)
    .where(eq(githubAccount.userId, actor.userId));
  return row ?? null;
}
