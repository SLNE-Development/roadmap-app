import { eq } from "drizzle-orm";
import { allowedAccount, system as systemTable, user, type ProjectRole } from "@/db/schema";
import type { Db } from "@/db/types";
import { newId } from "@/lib/id";
import type { Actor } from "@/lib/ops/actor";
import { setMember } from "@/lib/ops/members";
import { createProject } from "@/lib/ops/projects";

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

/**
 * Creates an owner and a project owned by them (with its default board).
 *
 * @param db the test database
 * @param slug the project slug, `demo` by default
 */
export async function createProjectFixture(db: Db, slug = "demo"): Promise<{ owner: Actor; slug: string; projectId: string }> {
  const owner = await insertUser(db, { name: "Owner" });
  const row = await createProject(db, owner, { slug, name: slug.toUpperCase() });
  return { owner, slug, projectId: row.id };
}

/** Creates a provisioned user and adds them to the project with `role`. */
export async function addMemberFixture(db: Db, owner: Actor, slug: string, role: ProjectRole): Promise<Actor> {
  const member = await insertUser(db, { name: `${role} member` });
  await setMember(db, owner, slug, { userId: member.userId, role });
  return member;
}

/** Marks a system's planning as complete directly in the database. */
export async function completePlanningFixture(db: Db, systemId: string): Promise<void> {
  await db
    .update(systemTable)
    .set({ planningCompletedAt: new Date(), planningConfirmation: "fixture" })
    .where(eq(systemTable.id, systemId));
}
