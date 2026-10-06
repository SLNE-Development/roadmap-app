import { getAuth } from "@/lib/auth/server";

/**
 * OAuth discovery for MCP clients: the authorization server metadata
 * (`/.well-known/oauth-authorization-server/api/auth`) and the protected resource metadata
 * of the MCP endpoint (`/.well-known/oauth-protected-resource/api/mcp`). Better Auth answers
 * both from the request path; any other well-known path is a 404 from its handler.
 */
export async function GET(request: Request): Promise<Response> {
  return getAuth().handler(request);
}
