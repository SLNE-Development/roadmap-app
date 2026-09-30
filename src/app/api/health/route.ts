import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/** Health checks must hit the database on every call. */
export const dynamic = "force-dynamic";

/** Reports 200 when the database answers, 503 otherwise. Used by the Docker health check. */
export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
