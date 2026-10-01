import { and, asc, count, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { FIRST_ADMIN_LOCK } from "@/db/locks";
import { allowedAccount, apikey, session, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError } from "./errors";

/** A provisioned Discord account together with the user it became, if they signed in. */
export interface AllowedAccountRow {
  discordId: string;
  displayName: string;
  createdAt: Date;
  userId: string | null;
  userName: string | null;
  isAdmin: boolean;
  isEventManager: boolean;
  isEventDeveloper: boolean;
}

/** Input of {@link addAllowedAccount}. */
export const addAllowedAccountInput = z.object({
  discordId: z.string().trim().regex(/^\d{15,21}$/, "a Discord user id is 15 to 21 digits"),
  displayName: z.string().trim().min(1).max(60),
});

/** Throws unless the actor is an admin. */
function requireAdmin(actor: Actor): void {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can manage accounts.");
}

/** Returns how many provisioned users carry the admin flag. */
async function adminCount(db: Executor): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(user.isAdmin, true));
  return row.n;
}

/** Returns whether `discordId` is on the allowlist; an empty id never is. */
export async function isAllowed(db: Executor, discordId: string): Promise<boolean> {
  if (!discordId) return false;
  const rows = await db
    .select({ id: allowedAccount.discordId })
    .from(allowedAccount)
    .where(eq(allowedAccount.discordId, discordId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Records the Discord id of a user who signed in with Discord, once. When no
 * other user exists, this first account becomes admin and is provisioned; any
 * later account is admitted only if an admin provisioned its id.
 */
export async function linkDiscordAccount(db: Db, userId: string, discordId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${FIRST_ADMIN_LOCK})`);
    const [linked] = await tx
      .update(user)
      .set({ discordId })
      .where(and(eq(user.id, userId), isNull(user.discordId)))
      .returning({ name: user.name });
    if (!linked) return;
    const [others] = await tx.select({ n: count() }).from(user)
      .where(and(ne(user.id, userId), isNotNull(user.discordId)));
    if (others.n > 0) return;
    await tx.update(user).set({ isAdmin: true }).where(eq(user.id, userId));
    await tx.insert(allowedAccount).values({ discordId, displayName: linked.name }).onConflictDoNothing();
  });
}

/**
 * Returns the actor for a user, or `null` when the user does not exist or their
 * Discord account is no longer on the allowlist.
 */
export async function loadActor(db: Executor, userId: string): Promise<Actor | null> {
  const [row] = await db
    .select({ id: user.id, name: user.name, isAdmin: user.isAdmin })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(user.id, userId))
    .limit(1);
  return row ? { userId: row.id, name: row.name, isAdmin: row.isAdmin } : null;
}

/** Lists every provisioned account with the user it became, oldest first. Admin only. */
export async function listAllowedAccounts(db: Db, actor: Actor): Promise<AllowedAccountRow[]> {
  requireAdmin(actor);
  const rows = await db
    .select({
      discordId: allowedAccount.discordId,
      displayName: allowedAccount.displayName,
      createdAt: allowedAccount.createdAt,
      userId: user.id,
      userName: user.name,
      isAdmin: user.isAdmin,
      isEventManager: user.isEventManager,
      isEventDeveloper: user.isEventDeveloper,
    })
    .from(allowedAccount)
    .leftJoin(user, eq(user.discordId, allowedAccount.discordId))
    .orderBy(asc(allowedAccount.createdAt), asc(allowedAccount.displayName));
  return rows.map((r) => ({
    ...r,
    isAdmin: r.isAdmin ?? false,
    isEventManager: r.isEventManager ?? false,
    isEventDeveloper: r.isEventDeveloper ?? false,
  }));
}

/**
 * Provisions a Discord account so it can sign in. Admin only.
 *
 * @throws ConflictError if the id is already provisioned
 */
export async function addAllowedAccount(db: Db, actor: Actor, raw: z.input<typeof addAllowedAccountInput>): Promise<void> {
  requireAdmin(actor);
  const input = addAllowedAccountInput.parse(raw);
  try {
    await db.insert(allowedAccount).values({ ...input, createdBy: actor.userId });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Discord id ${input.discordId} is already added.`);
    throw error;
  }
}

/**
 * Removes a provisioned account, ends the user's sessions and deletes their API
 * keys. The user row and project memberships stay but no longer grant access.
 * Admin only.
 *
 * @throws NotFoundError if the id is not provisioned
 * @throws ConflictError if it belongs to the last admin
 */
export async function removeAllowedAccount(db: Db, actor: Actor, discordId: string): Promise<void> {
  requireAdmin(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(allowedAccount).where(eq(allowedAccount.discordId, discordId)).limit(1);
    if (!row) throw new NotFoundError(`Unknown Discord id ${discordId}.`);
    await tx.select({ id: user.id }).from(user).where(eq(user.isAdmin, true)).for("no key update");
    const [target] = await tx.select().from(user).where(eq(user.discordId, discordId)).limit(1);
    if (target) {
      if (target.isAdmin && (await adminCount(tx)) === 1) throw new ConflictError("You cannot remove the last admin.");
      await tx.delete(session).where(eq(session.userId, target.id));
      await tx.delete(apikey).where(eq(apikey.referenceId, target.id));
      if (target.isAdmin) await tx.update(user).set({ isAdmin: false }).where(eq(user.id, target.id));
    }
    await tx.delete(allowedAccount).where(eq(allowedAccount.discordId, discordId));
  });
}

/**
 * Grants or revokes the admin flag. Admin only.
 *
 * @throws NotFoundError if the user does not exist
 * @throws ConflictError if it would leave no admin
 */
export async function setAdmin(db: Db, actor: Actor, userId: string, isAdmin: boolean): Promise<void> {
  requireAdmin(actor);
  await db.transaction(async (tx) => {
    await tx.select({ id: user.id }).from(user).where(eq(user.isAdmin, true)).for("no key update");
    const [target] = await tx
      .select({ id: user.id, name: user.name, isAdmin: user.isAdmin })
      .from(user)
      .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
      .where(eq(user.id, userId))
      .limit(1);
    if (!target) throw new NotFoundError(`Unknown user ${userId}.`);
    if (target.isAdmin === isAdmin) return;
    if (!isAdmin && (await adminCount(tx)) === 1) throw new ConflictError("The last admin cannot drop the admin flag.");
    await tx.update(user).set({ isAdmin }).where(and(eq(user.id, userId)));
  });
}

/**
 * Grants or revokes the event manager or event developer flag. Admin only; idempotent.
 *
 * @throws NotFoundError if the user does not exist or is no longer provisioned
 */
export async function setEventRole(db: Db, actor: Actor, userId: string, role: "manager" | "developer", value: boolean): Promise<void> {
  requireAdmin(actor);
  const [target] = await db
    .select({ id: user.id })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(user.id, userId))
    .limit(1);
  if (!target) throw new NotFoundError(`Unknown user ${userId}.`);
  await db.update(user).set(role === "manager" ? { isEventManager: value } : { isEventDeveloper: value }).where(eq(user.id, userId));
}

/** A provisioned user as offered in member pickers. */
export interface UserItem {
  id: string;
  name: string;
  image: string | null;
}

/**
 * Lists users whose Discord account is still provisioned, sorted by name. Only
 * owners of the project (and admins) may list them, to add members.
 *
 * @throws NotFoundError if the project is unknown or hidden from the actor
 * @throws ForbiddenError if the actor is not an owner
 */
export async function listUsers(db: Executor, actor: Actor, projectSlug: string): Promise<UserItem[]> {
  // A read that only needs the owner role, so the members page of an archived project still loads.
  await projectAccess(db, actor, projectSlug, "owner", { allowArchived: true });
  return db
    .select({ id: user.id, name: user.name, image: user.image })
    .from(user)
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .orderBy(asc(user.name));
}
