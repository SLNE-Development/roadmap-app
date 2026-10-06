/**
 * Returns the OAuth protected resource identifier of the MCP endpoint: `<BETTER_AUTH_URL>/api/mcp`.
 * Access tokens for MCP clients are bound to it as their audience.
 *
 * @throws Error naming `BETTER_AUTH_URL` when it is unset or empty
 */
export function mcpResource(): string {
  const base = process.env.BETTER_AUTH_URL;
  if (!base) throw new Error("BETTER_AUTH_URL is not set; see .env.example.");
  return `${base.replace(/\/+$/, "")}/api/mcp`;
}
