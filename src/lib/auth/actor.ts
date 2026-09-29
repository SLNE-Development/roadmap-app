import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { Actor } from "@/lib/ops/actor";
import { loadActor } from "@/lib/ops/users";
import { bearerToken } from "./bearer";
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
 * Returns the actor owning the API key in the request's bearer header, or `null`
 * when the key is missing, invalid, expired, rate limited, or its owner is no longer provisioned.
 */
export async function bearerActor(request: Request): Promise<Actor | null> {
  const key = bearerToken(request.headers.get("authorization"));
  if (!key) return null;
  const result = await getAuth().api.verifyApiKey({ body: { key } });
  if (!result.valid || !result.key) return null;
  return loadActor(getDb(), result.key.referenceId);
}
