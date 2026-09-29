/**
 * Returns the token of an `Authorization: Bearer <token>` header value, or `null`
 * when the header is missing, uses another scheme, or the token is empty or contains spaces.
 */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match ? match[1] : null;
}
