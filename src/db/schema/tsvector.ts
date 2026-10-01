import { customType } from "drizzle-orm/pg-core";

/** A Postgres `tsvector`, read as its text form; used for generated full-text search columns. */
export const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
