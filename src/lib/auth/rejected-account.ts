/** Name of the cookie that carries the Discord id of a rejected sign-in from the OAuth callback to the login page. */
export const REJECTED_ID_COOKIE = "rejected_discord_id";

/** How long the cookie lives, in seconds; the person only needs it for the page that follows the rejection. */
const MAX_AGE_SECONDS = 600;

/** The `?error=` code of a sign-in refused because the account is not on the allowlist (`NOT_PROVISIONED_CODE`); other failures never show an id. */
const REFUSAL_CODE = "not_provisioned";

/** A Discord snowflake. */
const DISCORD_ID = /^\d{5,25}$/;

/** The part of Better Auth's endpoint context that sets a cookie. */
export interface CookieSetter {
  setCookie: (name: string, value: string, options: { httpOnly: boolean; sameSite: "lax"; path: string; maxAge: number; secure: boolean }) => unknown;
}

/**
 * Remembers the Discord id of a refused sign-in for the person who made it: a short-lived `httpOnly` cookie on the
 * response of the OAuth callback, read only by the login page. The id never goes into a URL, so it is not logged by
 * proxies or kept in history, and no other visitor has the cookie. Outside a request it does nothing.
 */
export function rememberRejectedAccount(ctx: CookieSetter | null | undefined, discordId: string | null, secure: boolean): void {
  if (!ctx) return;
  // Without an id the cookie is still written, empty and expired, so an id from an earlier refusal never lingers.
  ctx.setCookie(REJECTED_ID_COOKIE, discordId ?? "", { httpOnly: true, sameSite: "lax", path: "/login", maxAge: discordId ? MAX_AGE_SECONDS : 0, secure });
}

/** Removes the cookie after a successful sign-in. */
export function clearRejectedAccount(ctx: CookieSetter | null | undefined, secure: boolean): void {
  rememberRejectedAccount(ctx, null, secure);
}

/**
 * Returns the Discord id the login page shows: only after a refusal by the allowlist and only when the cookie holds a
 * Discord id; null otherwise.
 *
 * @param errorCode the `error` query parameter of the page
 * @param cookie the value of {@link REJECTED_ID_COOKIE}
 */
export function rejectedAccountId(errorCode: string | undefined, cookie: string | undefined): string | null {
  if (!errorCode || !cookie || errorCode.toLowerCase() !== REFUSAL_CODE) return null;
  return DISCORD_ID.test(cookie) ? cookie : null;
}
