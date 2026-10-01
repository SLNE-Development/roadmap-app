import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { Actor } from "@/lib/ops/actor";
import { loadActor } from "@/lib/ops/users";
import { bearerToken } from "./bearer";
import { rateLimitOf } from "./rate-limit";
import { getAuth } from "./server";

/** Returns the signed-in actor of the current request, or `null` without a valid, provisioned session. */
export async function sessionActor(): Promise<Actor | null> {
  const found = await getAuth().api.getSession({ headers: await headers() });
  return found ? loadActor(getDb(), found.user.id) : null;
}

/** Returns the signed-in actor, redirecting to `/login` when there is none. */
export async function requireActor(): Promise<Actor> {
  const actor = await sessionActor();
  if (!actor) redirect("/login");
  return actor;
}

/**
 * Returns the actor owning the API key in the request's bearer header and the key's id,
 * or `null` when the key is missing, invalid, expired, disabled, or its owner is no longer provisioned.
 *
 * @throws ApiKeyRateLimitedError when the key is valid but over its rate limit
 */
export async function bearerAuth(request: Request): Promise<{ actor: Actor; apiKeyId: string } | null> {
  const key = bearerToken(request.headers.get("authorization"));
  if (!key) return null;
  const result = await getAuth().api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) {
    const limited = rateLimitOf(result.error);
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
