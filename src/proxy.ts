import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Sends requests without a session cookie to `/login`. This is a fast pre-check;
 * pages and actions verify the session itself.
 *
 * @param request the incoming request
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

/** Guards everything except the login page, the API (bearer or Better Auth) and static assets. */
export const config = {
  matcher: ["/((?!login|api/|_next/static|_next/image|favicon.ico).*)"],
};
