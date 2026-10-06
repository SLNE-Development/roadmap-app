import "server-only";
import { and, eq } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { oauthConsent } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { loadActor } from "@/lib/ops/users";

/**
 * Resolves the verified claims of an MCP access token to the user it acts for. The token
 * counts only while its user is provisioned and their consent to the client still exists,
 * so revoking a connected app takes effect at once rather than when the token expires.
 *
 * @param claims the access token's verified JWT payload; the client is `client_id`, else `azp`
 * @return the actor and the credential id agent runs are recorded under
 *   (`oauth:<userId>:<clientId>`), or `null`
 */
export async function oauthCredential(db: Executor, claims: JWTPayload): Promise<{ actor: Actor; credentialId: string } | null> {
  const userId = claims.sub;
  const clientId = typeof claims.client_id === "string" ? claims.client_id : typeof claims.azp === "string" ? claims.azp : null;
  if (!userId || !clientId) return null;
  const [granted] = await db
    .select({ id: oauthConsent.id })
    .from(oauthConsent)
    .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
    .limit(1);
  if (!granted) return null;
  const actor = await loadActor(db, userId);
  return actor ? { actor, credentialId: `oauth:${userId}:${clientId}` } : null;
}
