import { allowedAccount, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { newId } from "@/lib/id";
import type { Actor } from "@/lib/ops/actor";

/** Counter making fixture names, emails and Discord ids unique within a test. */
let seq = 0;

/**
 * Inserts a provisioned user (a `user` row plus its `allowedAccount`) and returns them as an actor.
 *
 * @param db the test database
 * @param opts optional name, admin flag and Discord id
 */
export async function insertUser(
  db: Db,
  opts: { name?: string; isAdmin?: boolean; discordId?: string } = {},
): Promise<Actor> {
  seq += 1;
  const id = newId();
  const name = opts.name ?? `User ${seq}`;
  const discordId = opts.discordId ?? String(100000000000000000n + BigInt(seq));
  await db.insert(user).values({ id, name, email: `u${seq}-${id}@example.test`, discordId, isAdmin: opts.isAdmin ?? false });
  await db.insert(allowedAccount).values({ discordId, displayName: name });
  return { userId: id, name, isAdmin: opts.isAdmin ?? false };
}
