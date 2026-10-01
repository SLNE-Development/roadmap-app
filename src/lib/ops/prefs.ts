import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { userPref } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { InvalidError } from "./errors";

/** A preference key: dot-separated segments starting lowercase, such as `board.collapsed.b1`. */
export const PREF_KEY = /^[a-z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+)*$/;

/** The largest stored value, measured on its JSON text. */
export const MAX_PREF_BYTES = 8192;

/** Schema for a preference key. */
export const prefKeySchema = z.string().max(128).regex(PREF_KEY);

/** Returns a user's value for `key`, or `null` when unset. */
export async function getPref(
  db: Executor,
  userId: string,
  key: string,
): Promise<unknown | null> {
  const [row] = await db
    .select({ value: userPref.value })
    .from(userPref)
    .where(and(eq(userPref.userId, userId), eq(userPref.key, key)));
  return row ? row.value : null;
}

/** Returns every preference of a user whose key starts with `prefix`, by key. */
export async function getPrefs(
  db: Executor,
  userId: string,
  prefix: string,
): Promise<Record<string, unknown>> {
  const escaped = prefix.replace(/[\\%_]/g, "\\$&");
  const rows = await db
    .select({ key: userPref.key, value: userPref.value })
    .from(userPref)
    .where(and(eq(userPref.userId, userId), like(userPref.key, `${escaped}%`)));
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Sets the actor's own preference `key`, replacing any earlier value. Not logged: prefs are personal. */
export async function setPref(
  db: Executor,
  actor: Actor,
  key: string,
  value: unknown,
): Promise<void> {
  const parsed = prefKeySchema.safeParse(key);
  if (!parsed.success)
    throw new InvalidError(
      "A preference key is lowercase words joined by dots, at most 128 characters.",
    );
  const json = JSON.stringify(value);
  if (json === undefined) throw new InvalidError("A preference needs a value.");
  if (Buffer.byteLength(json) > MAX_PREF_BYTES)
    throw new InvalidError("A preference must be at most 8 KB.");
  await db
    .insert(userPref)
    .values({ userId: actor.userId, key, value })
    .onConflictDoUpdate({
      target: [userPref.userId, userPref.key],
      set: { value, updatedAt: new Date() },
    });
}

/** Deletes the actor's own preference `key`; a missing key is fine. */
export async function deletePref(
  db: Executor,
  actor: Actor,
  key: string,
): Promise<void> {
  await db
    .delete(userPref)
    .where(and(eq(userPref.userId, actor.userId), eq(userPref.key, key)));
}
