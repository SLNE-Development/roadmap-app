import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";
import { resubscribePush } from "@/lib/ops/push";
import { siteUrl } from "@/lib/site";
import { describeUserAgent } from "@/lib/user-agent";

/** Reads the session and writes the database on every call. */
export const dynamic = "force-dynamic";

/**
 * Saves the subscription the browser replaced on its own, posted by the service worker as
 * `{ oldEndpoint, subscription, label }`. Responds 403 to anything but a same-origin JSON request, 401 without a
 * session and 400 for a malformed body.
 */
export async function POST(request: Request): Promise<Response> {
  if (!sameOriginJson(request)) return Response.json({ error: "Only this site may save push subscriptions." }, { status: 403 });
  const actor = await sessionActor();
  if (!actor) return Response.json({ error: "Sign in to receive push notifications." }, { status: 401 });
  const body: unknown = await request.json().catch(() => null);
  const described = describeUserAgent(request.headers.get("user-agent"));
  try {
    const { id } = await resubscribePush(getDb(), actor, body, described === "Unknown device" ? "This browser" : described);
    return Response.json({ id });
  } catch (error) {
    const status = statusOf(error);
    if (status === 500) console.error(error);
    return Response.json({ error: messageOf(error) }, { status });
  }
}

/**
 * Whether the request is JSON sent by a page or worker of this site, so another site cannot post it with the user's
 * cookie. The browser's `Sec-Fetch-Site` decides when present (so a www/apex mismatch with the site URL does not
 * matter); only without it is `Origin` compared to the site URL.
 */
function sameOriginJson(request: Request): boolean {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) return fetchSite === "same-origin";
  const origin = request.headers.get("origin");
  return origin === null || origin === siteUrl().origin;
}
