import "server-only";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { oauthClient } from "@/db/schema";
import { getAuth } from "./server";

/** What the consent page shows about the client asking for access. */
export interface ConsentRequest {
  clientId: string;
  /** The client's registered name, or its id when it gave none. */
  clientName: string;
  /** Host of the redirect URI this authorization sends its code to. */
  redirectHost: string;
}

/**
 * Reads the authorization request the OAuth provider redirected to the consent page with.
 * The query is signed by the provider; a missing, forged or expired signature, or an unknown
 * client, yields `null` and nothing may be granted.
 *
 * @param search the page's query string, without the leading `?`
 */
export async function consentRequest(search: string): Promise<ConsentRequest | null> {
  const { secret } = await getAuth().$context;
  if (!(await verifyOAuthQueryParams(search, secret))) return null;
  const query = new URLSearchParams(search);
  const clientId = query.get("client_id");
  if (!clientId) return null;
  const [client] = await getDb()
    .select({ name: oauthClient.name, redirectUris: oauthClient.redirectUris })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!client) return null;
  // The host shown is where this authorization's code goes: the request's own redirect_uri, which a
  // client with several registered URIs chooses per request, never simply the first one registered.
  // The provider matched it against the registered URIs (any port for loopback) before signing the query.
  const redirectUri = query.get("redirect_uri") ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null);
  if (!redirectUri) return null;
  let redirectHost: string;
  try {
    redirectHost = new URL(redirectUri).host;
  } catch {
    return null;
  }
  return { clientId, clientName: client.name || clientId, redirectHost };
}
