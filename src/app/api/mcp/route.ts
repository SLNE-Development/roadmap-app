import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/db/client";
import { bearerActor } from "@/lib/auth/actor";
import { ApiKeyRateLimitedError, rateLimitedResponse } from "@/lib/auth/rate-limit";
import { createMcpServer } from "@/lib/mcp/server";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";

/** The endpoint streams and reads the database, so it always runs per request on Node. */
export const dynamic = "force-dynamic";

/**
 * Serves one MCP request statelessly: resolves the API key to an actor, then
 * handles the request with a fresh server and transport. Responds 401 without a
 * valid key, 429 with `Retry-After` when the key is over its rate limit and a JSON error
 * for any other failure of the key check.
 *
 * @param request the incoming MCP HTTP request
 */
async function handle(request: Request): Promise<Response> {
  let actor: Actor | null;
  try {
    actor = await bearerActor(request);
  } catch (error) {
    if (error instanceof ApiKeyRateLimitedError) return rateLimitedResponse(error);
    const status = statusOf(error);
    if (status === 500) console.error(error);
    return Response.json({ error: messageOf(error) }, { status });
  }
  if (!actor) {
    return Response.json({ error: "Missing or invalid API key. Send Authorization: Bearer <ROADMAP_API_KEY>." }, { status: 401 });
  }
  const server = createMcpServer(getDb(), actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
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
