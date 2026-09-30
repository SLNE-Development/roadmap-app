import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends requests without a session cookie to `/login`, remembering the requested page in `next`. This is a fast pre-check;
 * pages and actions verify the session itself.
 *
 * @param request the incoming request
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

/**
 * Guards everything except the login page, the API (bearer or Better Auth), static assets,
 * icons, the manifest, the share image and the crawler files.
 */
export const config = {
  matcher: [
    "/((?!login|api/|_next/static|_next/image|favicon.ico|icon.svg|icon-\\d+\\.png|apple-icon.png|manifest.webmanifest|opengraph-image|robots.txt).*)",
  ],
};
