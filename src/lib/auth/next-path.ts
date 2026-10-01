/** The longest `next` path accepted; longer values are dropped. */
const MAX_LENGTH = 2048;

/** The only API routes a sign-in may return to: GitHub's redirects, whose query must survive the sign-in. */
const API_RETURNS = ["/api/github/setup", "/api/github/manifest/callback"];

/**
 * Turns a `next` query value into a same-origin relative path to return to after sign-in.
 * Anything else (other origins, protocol-relative or backslash paths, control characters,
 * the login page, the API except GitHub's redirect routes, over-long values) falls back to `"/"`. A repeated parameter uses
 * its last value.
 *
 * @param value the raw `next` value from the query string
 */
export function safeNextPath(value: string | string[] | undefined | null): string {
  const path = Array.isArray(value) ? value.at(-1) : value;
  if (!path || path.length > MAX_LENGTH) return "/";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  // Browsers strip tab, CR and LF from URLs, so "/\t/evil.test" would become "//evil.test".
  if (/[\u0000-\u001f\u007f]/.test(path)) return "/";
  if (path.startsWith("/login")) return "/";
  if (path.startsWith("/api/") && !API_RETURNS.some((p) => path === p || path.startsWith(`${p}?`))) return "/";
  return path;
}
