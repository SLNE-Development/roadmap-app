import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import type { Db } from "@/db/types";
import { valkeyKv, type Kv } from "@/lib/kv";
import { workerAlive } from "@/lib/metrics";
import { pingValkey } from "@/lib/valkey";

/** Health checks must hit the database and Valkey on every call. */
export const dynamic = "force-dynamic";

export interface HealthReport {
  ok: boolean;
  db: "up" | "down";
  valkey: "up" | "down";
  worker: "up" | "stale" | "unknown";
}

/** Probes the database, Valkey and the worker heartbeat; `ok` depends on the database only. */
export async function healthReport(deps: {
  db: Db;
  ping: () => Promise<boolean>;
  kv: Kv;
  now: () => Date;
}): Promise<HealthReport> {
  const db = await deps.db.execute(sql`select 1`).then(
    () => "up" as const,
    () => "down" as const,
  );
  const valkey = (await deps.ping()) ? "up" : "down";
  let worker: HealthReport["worker"] = "unknown";
  if (valkey === "up") {
    worker = await workerAlive(deps.kv, deps.now()).then(
      (alive) => (alive ? "up" : "stale"),
      () => "unknown",
    );
  }
  return { ok: db === "up", db, valkey, worker };
}

/** Reports 200 when the database answers, 503 otherwise. A Valkey outage never fails it. Used by the Docker health check. */
export async function GET(): Promise<Response> {
  const report = await healthReport({ db: getDb(), ping: pingValkey, kv: valkeyKv(), now: () => new Date() });
  return Response.json(report, { status: report.ok ? 200 : 503 });
}
