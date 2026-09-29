import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** A Drizzle database bound to the app schema, backed by postgres-js in the app and PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** A transaction opened on {@link Db}. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Anything queries can run on: the database or an open transaction. */
export type Executor = Db | Tx;
