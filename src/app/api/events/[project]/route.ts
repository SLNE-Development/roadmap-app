import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { ForbiddenError, NotFoundError } from "@/lib/ops/errors";
import { projectAccess } from "@/lib/ops/access";
import { loadActor } from "@/lib/ops/users";
import { realtimeChannel } from "@/lib/realtime/keys";
import { getHub } from "@/server/realtime/hub";
import { createEventStream, SSE_HEADERS } from "@/server/realtime/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change notices for one project as server-sent events; read-only and for signed-in members only (no API keys). */
export async function GET(request: Request, { params }: { params: Promise<{ project: string }> }): Promise<Response> {
  const actor = await sessionActor();
  if (!actor) return Response.json({ error: "Sign in to receive live updates." }, { status: 401 });
  const { project: slug } = await params;
  const db = getDb();
  let projectId: string;
  try {
    projectId = (await projectAccess(db, actor, slug, "viewer")).project.id;
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404 });
    throw error;
  }
  const stillAllowed = async () => {
    const current = await loadActor(db, actor.userId);
    if (!current) return false;
    try {
      await projectAccess(db, current, slug, "viewer");
      return true;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ForbiddenError) return false;
      throw error;
    }
  };
  return new Response(
    createEventStream({ hub: getHub(), channel: realtimeChannel(projectId), signal: request.signal, stillAllowed }),
    { headers: SSE_HEADERS },
  );
}
