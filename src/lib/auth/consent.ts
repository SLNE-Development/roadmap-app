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
  /** Host of the client's first redirect URI, where the grant is sent. */
  redirectHost: string | null;
}

/**
 * Reads the authorization request the OAuth provider redirected to the consent page with.
 * The query is signed by the provider; a missing, forged or expired signature, or an
 * unknown client, yields `null` and nothing may be granted.
 *
 * @param search the page's query string, without the leading `?`
 */
export async function consentRequest(search: string): Promise<ConsentRequest | null> {
  const { secret } = await getAuth().$context;
  if (!(await verifyOAuthQueryParams(search, secret))) return null;
  const clientId = new URLSearchParams(search).get("client_id");
  if (!clientId) return null;
  const [client] = await getDb()
    .select({ name: oauthClient.name, redirectUris: oauthClient.redirectUris })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId))
    .limit(1);
  if (!client) return null;
  let redirectHost: string | null = null;
  try {
    redirectHost = new URL(client.redirectUris[0]).host;
  } catch {
    redirectHost = null;
  }
  return { clientId, clientName: client.name || clientId, redirectHost };
}
