import { and, asc, count, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { allowedAccount, PROJECT_ROLES, project as projectTable, projectMember, user, type ProjectRole } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { loadActor } from "./users";

/** A project member as listed. */
export interface MemberItem {
  userId: string;
  name: string;
  image: string | null;
  role: ProjectRole;
  /** When the user was added to the project; role changes keep it. */
  joinedAt: Date;
}

/** Input of {@link setMember}. */
export const setMemberInput = z.object({ userId: z.string().min(1), role: z.enum(PROJECT_ROLES) });

/** Returns whether the user is a member of the project, in any role; removed (non-provisioned) accounts never are. */
export async function isMember(db: Executor, projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ userId: projectMember.userId })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

/** Throws if removing or demoting `userId` would leave the project without an owner. */
async function keepAnOwner(tx: Executor, projectId: string, userId: string): Promise<void> {
  const [row] = await tx
    .select({ n: count() })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.role, "owner"), ne(projectMember.userId, userId)));
  if (row.n === 0) throw new ConflictError("A project needs at least one owner.");
}

/** Lists the members of a project, by name; removed accounts are left out. */
export async function listMembers(db: Executor, actor: Actor, slug: string): Promise<MemberItem[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  return db
    .select({ userId: user.id, name: user.name, image: user.image, role: projectMember.role, joinedAt: projectMember.createdAt })
    .from(projectMember)
    .innerJoin(user, eq(user.id, projectMember.userId))
    .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
    .where(eq(projectMember.projectId, project.id))
    .orderBy(asc(user.name));
}

/**
 * Adds a provisioned user to the project or changes their role. Owner only.
 *
 * @throws NotFoundError if the user is unknown or no longer provisioned
 * @throws ConflictError if it would demote the last owner
 */
export async function setMember(db: Db, actor: Actor, slug: string, raw: z.input<typeof setMemberInput>): Promise<void> {
  const input = setMemberInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "owner", { allowArchived: true });
    await tx.select({ id: projectTable.id }).from(projectTable).where(eq(projectTable.id, project.id)).for("no key update");
    const target = await loadActor(tx, input.userId);
    if (!target) throw new NotFoundError(`Unknown user ${input.userId}.`);
    const [current] = await tx
      .select({ role: projectMember.role })
      .from(projectMember)
      .where(and(eq(projectMember.projectId, project.id), eq(projectMember.userId, input.userId)));
    if (current?.role === input.role) return;
    if (current?.role === "owner") await keepAnOwner(tx, project.id, input.userId);
    await tx
      .insert(projectMember)
      .values({ projectId: project.id, userId: input.userId, role: input.role })
      .onConflictDoUpdate({ target: [projectMember.projectId, projectMember.userId], set: { role: input.role } });
    await logChange(tx, actor, {
      projectId: project.id,
      entity: "member",
      entityId: input.userId,
      field: "role",
      oldValue: current ? `${target.name}: ${current.role}` : null,
      newValue: `${target.name}: ${input.role}`,
    });
  });
}

/**
 * Removes a member from the project. Owner only.
 *
 * @throws NotFoundError if the user is not a member
 * @throws ConflictError if they are the last owner
 */
export async function removeMember(db: Db, actor: Actor, slug: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "owner", { allowArchived: true });
    await tx.select({ id: projectTable.id }).from(projectTable).where(eq(projectTable.id, project.id)).for("no key update");
    const [current] = await tx
      .select({ role: projectMember.role, name: user.name })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .where(and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)));
    if (!current) throw new NotFoundError(`User ${userId} is not a member of ${slug}.`);
    if (current.role === "owner") await keepAnOwner(tx, project.id, userId);
    await tx.delete(projectMember).where(and(eq(projectMember.projectId, project.id), eq(projectMember.userId, userId)));
    await logChange(tx, actor, {
      projectId: project.id,
      entity: "member",
      entityId: userId,
      field: "removed",
      oldValue: `${current.name}: ${current.role}`,
    });
  });
}
