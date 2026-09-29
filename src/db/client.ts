import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import type { Db } from "./types";

/** Process-wide cache so hot reloads and concurrent requests share one pool. */
const globalForDb = globalThis as unknown as { roadmapDb?: Db };

/**
 * Returns the app database, connecting to `DATABASE_URL` with at most 5 pooled connections.
 *
 * @throws Error if `DATABASE_URL` is unset
 */
export function getDb(): Db {
  if (!globalForDb.roadmapDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set; the roadmap app refuses to run without it.");
    globalForDb.roadmapDb = drizzle({ client: postgres(url, { max: 5 }), schema });
  }
  return globalForDb.roadmapDb;
}
