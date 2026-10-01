import "server-only";
import { defaultKeyHasher } from "@better-auth/api-key";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { apikey } from "@/db/schema";
import { valkeyKv } from "@/lib/kv";
import type { Actor } from "@/lib/ops/actor";
import { recordThrottled } from "@/lib/ops/audit";
import { loadActor } from "@/lib/ops/users";
import { bearerToken } from "./bearer";
import { rateLimitOf } from "./rate-limit";
import { getAuth } from "./server";

/** Returns the signed-in actor of the current request and the id of its session, or `null` without a valid, provisioned session. */
export async function sessionAuth(): Promise<{ actor: Actor; sessionId: string } | null> {
  const found = await getAuth().api.getSession({ headers: await headers() });
  if (!found) return null;
  const actor = await loadActor(getDb(), found.user.id);
  return actor ? { actor, sessionId: found.session.id } : null;
}

/** Returns the signed-in actor of the current request, or `null` without a valid, provisioned session. */
export async function sessionActor(): Promise<Actor | null> {
  return (await sessionAuth())?.actor ?? null;
}

/** Returns the signed-in actor, redirecting to `/login` when there is none. */
export async function requireActor(): Promise<Actor> {
  const actor = await sessionActor();
  if (!actor) redirect("/login");
  return actor;
}

/** The client's address and user agent from request headers, for auth events; the first `x-forwarded-for` hop wins. */
export function clientOf(h: Headers): { ip: string | null; userAgent: string | null } {
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}

/** The client of the current request; see {@link clientOf}. */
export async function requestClient(): Promise<{ ip: string | null; userAgent: string | null }> {
  return clientOf(await headers());
}

/** How long repeated rejected or rate-limited events of one key are recorded only once. */
const KEY_EVENT_THROTTLE_SECONDS = 60;

/**
 * Records a rejected or rate-limited key as an auth event, at most once a minute per key.
 * Never stores the key: a rejected key is throttled by its first 12 characters (its detail is the failure code),
 * a rate-limited one by its id.
 */
async function recordKeyFailure(request: Request, key: string, rateLimited: boolean, code: string | undefined): Promise<void> {
  try {
    const db = getDb();
    const client = clientOf(request.headers);
    if (!rateLimited) {
      const event = { kind: "key-rejected" as const, userId: null, discordId: null, apiKeyId: null, ...client, detail: code ?? null };
      await recordThrottled(db, valkeyKv(), event, `audit:rej:${key.slice(0, 12)}`, KEY_EVENT_THROTTLE_SECONDS);
      return;
    }
    const [row] = await db
      .select({ id: apikey.id, userId: apikey.referenceId })
      .from(apikey)
      .where(eq(apikey.key, await defaultKeyHasher(key)))
      .limit(1);
    if (!row) return;
    const event = { kind: "key-rate-limited" as const, userId: row.userId, discordId: null, apiKeyId: row.id, ...client, detail: null };
    await recordThrottled(db, valkeyKv(), event, `audit:rl:${row.id}`, KEY_EVENT_THROTTLE_SECONDS);
  } catch (error) {
    console.error(error);
  }
}

/**
 * Returns the actor owning the API key in the request's bearer header and the key's id,
 * or `null` when the key is missing, invalid, expired, disabled, or its owner is no longer provisioned.
 * Rejected and rate-limited keys are recorded as auth events.
 *
 * @throws ApiKeyRateLimitedError when the key is valid but over its rate limit
 */
export async function bearerAuth(request: Request): Promise<{ actor: Actor; apiKeyId: string } | null> {
  const key = bearerToken(request.headers.get("authorization"));
  if (!key) return null;
  const result = await getAuth().api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) {
    const limited = rateLimitOf(result.error);
    await recordKeyFailure(request, key, !!limited, result.error?.code);
    if (limited) throw limited;
    return null;
  }
  const actor = await loadActor(getDb(), result.key.referenceId);
  return actor ? { actor, apiKeyId: result.key.id } : null;
}

/**
 * Returns the actor owning the API key in the request's bearer header, or `null`; see {@link bearerAuth}.
 *
 * @throws ApiKeyRateLimitedError when the key is valid but over its rate limit
 */
export async function bearerActor(request: Request): Promise<Actor | null> {
  return (await bearerAuth(request))?.actor ?? null;
}
