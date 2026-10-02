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

/** The clones made while a test runs; each holds a whole Postgres in memory until it is closed. */
const openInTest = new Set<PGlite>();
let inTest = false;

/** Marks the start of a test: clones made from now on are closed when it ends (see `src/test/setup.ts`). */
export function beginTestDbScope(): void {
  inTest = true;
}

/** Closes the clones made during the test that just ended. Clones made in `beforeAll` stay open for their file. */
export async function endTestDbScope(): Promise<void> {
  inTest = false;
  const clients = [...openInTest];
  openInTest.clear();
  await Promise.all(clients.map((client) => client.close().catch(() => {})));
}

/** Returns an isolated, migrated, empty database for one test. */
export async function createTestDb(): Promise<Db> {
  template ??= migratedTemplate();
  const client = (await (await template).clone()) as PGlite;
  if (inTest) openInTest.add(client);
  return drizzle({ client, schema });
}
