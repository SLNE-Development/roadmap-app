import { z } from "zod";

/** The largest value of a Postgres `integer` column. */
export const MAX_INT = 2147483647;

/** The id of a referenced row; an empty string is invalid instead of reaching the database. */
export const entityId = z.string().trim().min(1);

/** {@link entityId} or `null` to clear the reference. */
export const nullableEntityId = entityId.nullable();

/** A positive integer that fits a Postgres `integer` column. */
export const dbInt = z.number().int().min(1).max(MAX_INT);
