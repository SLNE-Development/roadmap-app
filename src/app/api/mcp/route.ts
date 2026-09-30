import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/db/client";
import { bearerActor } from "@/lib/auth/actor";
import { createMcpServer } from "@/lib/mcp/server";

/** The endpoint streams and reads the database, so it always runs per request on Node. */
export const dynamic = "force-dynamic";

/**
 * Serves one MCP request statelessly: resolves the API key to an actor, then
 * handles the request with a fresh server and transport.
 *
 * @param request the incoming MCP HTTP request
 */
async function handle(request: Request): Promise<Response> {
  const actor = await bearerActor(request);
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

/** MCP server-to-client stream requests. */
export const GET = handle;

/** MCP session termination requests. */
export const DELETE = handle;
