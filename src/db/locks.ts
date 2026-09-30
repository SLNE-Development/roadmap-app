/** Postgres advisory lock key serialising schema migrations across replicas. */
export const MIGRATION_LOCK = 727_001;

/** Postgres advisory lock key serialising the choice of the first admin. */
export const FIRST_ADMIN_LOCK = 727_002;
