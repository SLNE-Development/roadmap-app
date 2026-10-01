import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db/client";
import { valkeyKv } from "@/lib/kv";
import { registerBuiltinMetrics, renderMetrics } from "@/lib/metrics";
import { bullQueueRaw } from "@/lib/queue";
import { pingValkey } from "@/lib/valkey";

/** Metrics must be collected on every scrape. */
export const dynamic = "force-dynamic";

/** Whether `header` is `Bearer <token>` for exactly `token`, compared in constant time. */
function tokenMatches(header: string | null, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "");
  if (!match) return false;
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Serves metrics: 404 without a configured token, 401 for a wrong one, otherwise the rendered text. */
export async function handleMetrics(
  request: Request,
  env: { METRICS_TOKEN?: string },
  render: () => Promise<string>,
): Promise<Response> {
  if (!env.METRICS_TOKEN) return new Response(null, { status: 404 });
  if (!tokenMatches(request.headers.get("authorization"), env.METRICS_TOKEN)) {
    return Response.json({ error: "Missing or invalid metrics token." }, { status: 401 });
  }
  return new Response(await render(), { headers: { "content-type": "text/plain; version=0.0.4" } });
}

let registered = false;

/** Prometheus scrape endpoint; registers the built-in metrics on the first authorised request. */
export async function GET(request: Request): Promise<Response> {
  return handleMetrics(request, { METRICS_TOKEN: process.env.METRICS_TOKEN }, async () => {
    if (!registered) {
      registered = true;
      registerBuiltinMetrics({
        db: getDb(),
        kv: valkeyKv(),
        queueCounts: (q) => bullQueueRaw(q).getJobCounts("waiting", "active", "delayed", "failed"),
        pingValkey,
      });
    }
    return renderMetrics();
  });
}
