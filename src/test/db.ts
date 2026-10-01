import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";

/** A migrated, empty in-memory database that every test clones. */
let template: Promise<PGlite> | undefined;

/** Creates the template once per test worker: a fresh PGlite with all migrations applied. */
async function migratedTemplate(): Promise<PGlite> {
  const client = new PGlite({ extensions: { pg_trgm } });
  await migrate(drizzle({ client, schema }), { migrationsFolder: "./drizzle" });
  return client;
}

/** Returns an isolated, migrated, empty database for one test. */
export async function createTestDb(): Promise<Db> {
  template ??= migratedTemplate();
  const client = (await (await template).clone()) as PGlite;
  return drizzle({ client, schema });
}
