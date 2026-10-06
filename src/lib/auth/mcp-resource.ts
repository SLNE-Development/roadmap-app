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

/**
 * Returns where the MCP endpoint reads the access-token signing keys: this server's own JWKS
 * endpoint over loopback (`PORT`, default 3000, as the Docker image binds). Going through the
 * public URL instead would depend on the container reaching its own public hostname.
 */
export function internalJwksUrl(): string {
  return `http://127.0.0.1:${process.env.PORT || 3000}/api/auth/jwks`;
}
