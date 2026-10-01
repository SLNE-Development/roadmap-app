import { z } from "zod";
import { getDb } from "@/db/client";
import { sessionActor } from "@/lib/auth/actor";
import { valkeyBus } from "@/lib/bus";
import { valkeyKv } from "@/lib/kv";
import { slugSchema } from "@/lib/ops/access";
import { NotFoundError } from "@/lib/ops/errors";
import { heartbeat } from "@/lib/ops/presence";
import { realtimeChannel } from "@/lib/realtime/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ERROR_LOG_INTERVAL_MS = 60_000;
let lastErrorLog = 0;

const bodySchema = z.object({ project: slugSchema, system: slugSchema, leaving: z.boolean().optional() });

/**
 * Records that the signed-in user views a system, posted as `{ project, system, leaving? }` as JSON or, from
 * `navigator.sendBeacon`, as a plain-text body. Answers 204, 400 for a bad body, 401 without a session and 404 when
 * the system is not visible. A change of viewers is announced to the project's open pages.
 */
export async function POST(request: Request): Promise<Response> {
  const actor = await sessionActor();
  if (!actor) return Response.json({ error: "Sign in to share your presence." }, { status: 401 });
  let raw: unknown = null;
  try {
    raw = JSON.parse(await request.text());
  } catch {
    // stays null and fails validation below
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Send { project, system, leaving? }." }, { status: 400 });
  try {
    const { changed, projectId } = await heartbeat(getDb(), valkeyKv(), actor, parsed.data, new Date());
    // A failed publish only delays other viewers' refresh, so it never fails the request.
    if (changed) await valkeyBus().publish(realtimeChannel(projectId), { keys: ["presence"] }).catch(() => {});
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404 });
    // Valkey being down must not fail the heartbeat; every open page beats every 30 s, so log once a minute.
    const now = Date.now();
    if (now - lastErrorLog >= ERROR_LOG_INTERVAL_MS) {
      lastErrorLog = now;
      console.error(error);
    }
  }
  return new Response(null, { status: 204 });
}
