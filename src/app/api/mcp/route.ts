import { requireMcpAuth } from "@better-auth/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { after } from "next/server";
import { getDb } from "@/db/client";
import { bearerAuth } from "@/lib/auth/actor";
import { bearerToken } from "@/lib/auth/bearer";
import { oauthCredential } from "@/lib/auth/mcp-auth";
import { internalJwksUrl, mcpResource } from "@/lib/auth/mcp-resource";
import { ApiKeyRateLimitedError, rateLimitedResponse } from "@/lib/auth/rate-limit";
import { getAuth } from "@/lib/auth/server";
import { createMcpServer } from "@/lib/mcp/server";
import type { Actor } from "@/lib/ops/actor";
import { recordCall } from "@/lib/ops/agent-runs";
import { messageOf, statusOf } from "@/lib/ops/errors";

/** The endpoint streams and reads the database, so it always runs per request on Node. */
export const dynamic = "force-dynamic";

/**
 * Handles one MCP request statelessly with a fresh server and transport acting as `actor`,
 * recording each tool call under `credentialId` (an API key id or `oauth:<userId>:<clientId>`).
 */
async function serve(request: Request, actor: Actor, credentialId: string): Promise<Response> {
  const server = createMcpServer(getDb(), actor, {
    apiKeyId: credentialId,
    // Recording runs after the response, so agents never wait for it, and it does not
    // depend on the worker, so runs keep recording while Valkey or the worker is down.
    recordCall: (r) => after(() => recordCall(getDb(), r).catch((e) => console.error(e))),
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/**
 * Serves a request carrying an `rmk_` API key. Responds 401 without a valid key, 429 with
 * `Retry-After` when the key is over its rate limit and a JSON error for any other failure
 * of the key check.
 */
async function withApiKey(request: Request): Promise<Response> {
  let auth: Awaited<ReturnType<typeof bearerAuth>>;
  try {
    auth = await bearerAuth(request);
  } catch (error) {
    if (error instanceof ApiKeyRateLimitedError) return rateLimitedResponse(error);
    const status = statusOf(error);
    if (status === 500) console.error(error);
    return Response.json({ error: messageOf(error) }, { status });
  }
  if (!auth) {
    return Response.json({ error: "Missing or invalid API key. Send Authorization: Bearer <ROADMAP_API_KEY>." }, { status: 401 });
  }
  return serve(request, auth.actor, auth.apiKeyId);
}

/**
 * The 401 for a valid access token that no longer counts (consent revoked, user removed),
 * pointing the client at the protected resource metadata so it signs in again.
 */
function revokedResponse(): Response {
  const resource = new URL(mcpResource());
  const metadata = `${resource.origin}/.well-known/oauth-protected-resource${resource.pathname}`;
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message: "Access was revoked; sign in again." }, id: null },
    { status: 401, headers: { "www-authenticate": `Bearer error="invalid_token", error_description="Access was revoked", resource_metadata="${metadata}"` } },
  );
}

/** Lazily built OAuth path, so builds without environment variables do not create the auth instance. */
let oauthHandler: ((request: Request) => Promise<Response>) | undefined;

/**
 * Serves a request carrying an OAuth access token: Better Auth verifies it against its JWKS,
 * read from this server over loopback (signature, issuer, audience, expiry) and challenges anything else with `WWW-Authenticate`
 * so MCP clients start the sign-in.
 */
function withAccessToken(request: Request): Promise<Response> {
  oauthHandler ??= requireMcpAuth(
    getAuth(),
    async (verified, claims) => {
      const credential = await oauthCredential(getDb(), claims);
      return credential ? serve(verified, credential.actor, credential.credentialId) : revokedResponse();
    },
    { resource: mcpResource(), jwksUrl: internalJwksUrl() },
  );
  return oauthHandler(request);
}

/**
 * Serves one MCP request. An `rmk_` bearer is an API key; any other bearer, or none, goes
 * through OAuth.
 *
 * @param request the incoming MCP HTTP request
 */
async function handle(request: Request): Promise<Response> {
  const token = bearerToken(request.headers.get("authorization"));
  return token?.startsWith("rmk_") ? withApiKey(request) : withAccessToken(request);
}

/** MCP requests (initialize, tool calls). */
export const POST = handle;

/** The stateless server never pushes messages, so the server-to-client stream is not offered. */
export async function GET(): Promise<Response> {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

/** MCP session termination requests. */
export const DELETE = handle;
