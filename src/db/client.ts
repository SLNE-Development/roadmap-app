import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";
import type { Db } from "./types";

/** Process-wide cache so hot reloads and concurrent requests share one pool. */
const globalForDb = globalThis as unknown as { roadmapDb?: { db: Db; client: Sql } };

/**
 * Returns the app database, connecting to `DATABASE_URL` with at most 5 pooled connections.
 *
 * @throws Error if `DATABASE_URL` is unset
 */
export function getDb(): Db {
  if (!globalForDb.roadmapDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set; the roadmap app refuses to run without it.");
    const client = postgres(url, { max: 5 });
    globalForDb.roadmapDb = { db: drizzle({ client, schema }), client };
  }
  return globalForDb.roadmapDb.db;
}

/** Ends the pooled connections, if any, and clears the cache. */
export async function closeDb(): Promise<void> {
  const cached = globalForDb.roadmapDb;
  globalForDb.roadmapDb = undefined;
  if (cached) await cached.client.end();
}
