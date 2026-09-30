import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { MIGRATION_LOCK } from "./locks";

/**
 * Applies every pending migration in `folder` to the database at `url` over a
 * dedicated connection, which is closed afterwards.
 *
 * @param url a Postgres connection URL
 * @param folder the directory holding the generated SQL migrations
 */
export async function runMigrations(url: string, folder = "./drizzle"): Promise<void> {
  const client = postgres(url, { max: 1 });
  try {
    // `max: 1` keeps every statement on one session, so lock and unlock match.
    await client`select pg_advisory_lock(${MIGRATION_LOCK})`;
    try {
      await migrate(drizzle({ client }), { migrationsFolder: folder });
    } finally {
      await client`select pg_advisory_unlock(${MIGRATION_LOCK})`;
    }
  } finally {
    await client.end();
  }
}
