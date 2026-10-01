import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { getGitHubApi } from "@/lib/github/api";
import { valkeyKv } from "@/lib/kv";
import { ConflictError, ForbiddenError } from "@/lib/ops/errors";
import { cancelGitHubLink, completeGitHubLink } from "@/lib/ops/github-accounts";
import { siteUrl } from "@/lib/site";

/** Reads the session and writes the database on every call. */
export const dynamic = "force-dynamic";

/** A 303 to a path of this site. */
function to(path: string): Response {
  return Response.redirect(new URL(path, siteUrl()), 303);
}

/** Where GitHub sends the user after authorizing the App: links their GitHub login and returns to the connections page. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const actor = await sessionActor();
  // GitHub's code and state must survive the sign-in.
  if (!actor) return to(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  // GitHub answers ?error=access_denied (and the like) when the user cancels.
  if (url.searchParams.has("error")) {
    await cancelGitHubLink(valkeyKv(), state).catch(() => {});
    return to("/settings/connections?error=github");
  }
  if (!code || !state) return to("/settings/connections?error=state");
  const db = getDb();
  try {
    await completeGitHubLink(db, valkeyKv(), await getGitHubApi(db), actor.userId, code, state);
    return to("/settings/connections?linked=1");
  } catch (error) {
    if (error instanceof ForbiddenError) return to("/settings/connections?error=state");
    if (error instanceof ConflictError) return to("/settings/connections?error=taken");
    console.error("github login link failed", error);
    return to("/settings/connections?error=github");
  }
}
