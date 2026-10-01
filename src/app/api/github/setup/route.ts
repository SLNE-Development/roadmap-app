import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { getGitHubApi } from "@/lib/github/api";
import { valkeyKv } from "@/lib/kv";
import { recordInstallation } from "@/lib/ops/github-app";
import { siteUrl } from "@/lib/site";

/** Reads the session and writes the database on every call. */
export const dynamic = "force-dynamic";

/** A 303 to a path of this site. */
function to(path: string): Response {
  return Response.redirect(new URL(path, siteUrl()), 303);
}

/** Where GitHub sends the user after installing, updating or requesting the App: records it and returns. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const actor = await sessionActor();
  // GitHub's code or installation id must survive the sign-in.
  if (!actor) return to(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const params = url.searchParams;
  const rawId = params.get("installation_id");
  const installationId = rawId && /^[1-9][0-9]{0,15}$/.test(rawId) ? Number(rawId) : null;
  if (rawId && installationId === null) return to("/admin/github?error=installation");
  const db = getDb();
  try {
    const path = await recordInstallation(db, valkeyKv(), await getGitHubApi(db), actor.userId, {
      installationId,
      setupAction: params.get("setup_action"),
      state: params.get("state"),
    });
    return to(path);
  } catch (error) {
    console.error("github installation setup failed", error);
    return to("/admin/github?error=github");
  }
}
