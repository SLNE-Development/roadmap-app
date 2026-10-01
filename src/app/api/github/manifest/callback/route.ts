import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { getGitHubApi } from "@/lib/github/api";
import { valkeyKv } from "@/lib/kv";
import { ForbiddenError } from "@/lib/ops/errors";
import { completeManifest } from "@/lib/ops/github-app";
import { siteUrl } from "@/lib/site";

/** Reads the session and writes the database on every call. */
export const dynamic = "force-dynamic";

/** A 303 to a path of this site. */
function to(path: string): Response {
  return Response.redirect(new URL(path, siteUrl()), 303);
}

/** Where GitHub sends the admin after registering the App from the manifest: stores the new App's credentials. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const actor = await sessionActor();
  // GitHub's code or installation id must survive the sign-in.
  if (!actor) return to(`/login?next=${encodeURIComponent(url.pathname + url.search)}`);
  const params = url.searchParams;
  const db = getDb();
  try {
    await completeManifest(db, valkeyKv(), await getGitHubApi(db), actor.userId, params.get("code") ?? "", params.get("state") ?? "");
  } catch (error) {
    if (error instanceof ForbiddenError) return to("/admin/github?error=state");
    console.error("github manifest conversion failed", error);
    return to("/admin/github?error=github");
  }
  return to("/admin/github?created=1");
}
