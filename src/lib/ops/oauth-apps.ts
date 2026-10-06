import "server-only";
import { and, eq, inArray, max } from "drizzle-orm";
import { agentRun, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";

/** An OAuth client (an MCP client such as Claude Code) the actor allowed to act as them. */
export interface ConnectedApp {
  clientId: string;
  /** The client's registered name; else the host of a URL client id; else the id itself. */
  name: string;
  grantedAt: Date;
  /** The last MCP call made with the client's tokens, or `null` when none was recorded. */
  lastUsedAt: Date | null;
}

/** Returns a readable name for a client that registered without one. */
function fallbackName(clientId: string): string {
  try {
    return new URL(clientId).host || clientId;
  } catch {
    return clientId;
  }
}

/** The agent-run credential id of the actor's calls through `clientId`; see `oauthCredential`. */
function credentialId(actor: Actor, clientId: string): string {
  return `oauth:${actor.userId}:${clientId}`;
}

/** Lists the clients the actor consented to, newest grant first. */
export async function listConnectedApps(db: Db, actor: Actor): Promise<ConnectedApp[]> {
  const rows = await db
    .select({ clientId: oauthConsent.clientId, name: oauthClient.name, grantedAt: oauthConsent.createdAt })
    .from(oauthConsent)
    .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
    .where(eq(oauthConsent.userId, actor.userId));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => credentialId(actor, r.clientId));
  const used = await db
    .select({ key: agentRun.apiKeyId, at: max(agentRun.lastCallAt) })
    .from(agentRun)
    .where(and(eq(agentRun.userId, actor.userId), inArray(agentRun.apiKeyId, ids)))
    .groupBy(agentRun.apiKeyId);
  const lastUse = new Map(used.map((u) => [u.key, u.at]));
  return rows
    .map((r) => ({
      clientId: r.clientId,
      name: r.name || fallbackName(r.clientId),
      grantedAt: r.grantedAt,
      lastUsedAt: lastUse.get(credentialId(actor, r.clientId)) ?? null,
    }))
    .sort((a, b) => b.grantedAt.getTime() - a.grantedAt.getTime());
}

/**
 * Disconnects a client from the actor: deletes their consent and every access and refresh
 * token the client holds for them. Tokens already issued stop working at once, because the
 * MCP endpoint requires the consent on every request.
 *
 * @throws NotFoundError when the actor never consented to the client
 */
export async function revokeConnectedApp(db: Db, actor: Actor, clientId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const mine = and(eq(oauthConsent.userId, actor.userId), eq(oauthConsent.clientId, clientId));
    const deleted = await tx.delete(oauthConsent).where(mine).returning({ id: oauthConsent.id });
    if (deleted.length === 0) throw new NotFoundError(`No connected app ${clientId}.`);
    await tx.delete(oauthAccessToken).where(and(eq(oauthAccessToken.userId, actor.userId), eq(oauthAccessToken.clientId, clientId)));
    await tx.delete(oauthRefreshToken).where(and(eq(oauthRefreshToken.userId, actor.userId), eq(oauthRefreshToken.clientId, clientId)));
  });
}
