import { and, asc, count, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { allowedAccount, project, projectMember, savedView, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";

/** A saved view as stored. */
export type SavedViewRow = typeof savedView.$inferSelect;

/** Input of {@link createSavedView}. */
export const savedViewInput = z.object({
  name: z.string().trim().min(1).max(60),
  path: z.string().max(300),
  query: z.string().max(1000).default(""),
});

/** The most views a user can keep. */
export const SAVED_VIEW_LIMIT = 30;

/** The project pages a view can be saved for; the first group is the project slug. */
export const ALLOWED_VIEW_PATH =
  /^\/p\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(boards\/[a-z0-9-]+|systems|activity|questions|adrs|roadmap)$/;

/** The global pages a view can be saved for. */
const GLOBAL_VIEW_PATHS = ["/", "/workload"];

/** Loads the actor's own view, locking it, or throws a 404. */
async function ownView(tx: Executor, actor: Actor, id: string): Promise<SavedViewRow> {
  const [row] = await tx
    .select()
    .from(savedView)
    .where(and(eq(savedView.id, id), eq(savedView.userId, actor.userId)))
    .for("update");
  if (!row) throw new NotFoundError("Unknown view.");
  return row;
}

/**
 * Saves a filtered page for the actor, pinned, after their other views. Views
 * are personal and not logged.
 *
 * @throws InvalidError if the path is not a page views can be saved for
 * @throws NotFoundError if the path names a project the actor cannot see
 * @throws ConflictError if the actor already has {@link SAVED_VIEW_LIMIT} views
 */
export async function createSavedView(db: Db, actor: Actor, raw: z.input<typeof savedViewInput>): Promise<SavedViewRow> {
  const input = savedViewInput.parse(raw);
  const slug = ALLOWED_VIEW_PATH.exec(input.path)?.[1];
  if (!slug && !GLOBAL_VIEW_PATHS.includes(input.path)) {
    throw new InvalidError("Views can be saved for boards, systems, activity, questions, decisions, the roadmap and workload.");
  }
  return db.transaction(async (tx) => {
    const projectId = slug ? (await projectAccess(tx, actor, slug, "viewer")).project.id : null;
    // Serialises this user's creates so the limit and the sort order hold.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, actor.userId)).for("update");
    const [{ n, last }] = await tx
      .select({ n: count(), last: max(savedView.sortOrder) })
      .from(savedView)
      .where(eq(savedView.userId, actor.userId));
    if (n >= SAVED_VIEW_LIMIT) throw new ConflictError(`You can keep up to ${SAVED_VIEW_LIMIT} views. Delete one first.`);
    const [row] = await tx
      .insert(savedView)
      .values({
        id: newId(),
        userId: actor.userId,
        projectId,
        name: input.name,
        path: input.path,
        query: input.query.replace(/^\?/, ""),
        sortOrder: (last ?? -1) + 1,
      })
      .returning();
    return row;
  });
}

/**
 * Lists the actor's views in order. Views of a project are left out unless the
 * actor is still an active member and the project is not archived, so a lost
 * project never shows up here.
 *
 * @param opts.projectId only this project's views plus the global ones
 */
export async function listSavedViews(db: Executor, actor: Actor, opts: { projectId?: string }): Promise<SavedViewRow[]> {
  const [views, visible] = await Promise.all([
    db.select().from(savedView).where(eq(savedView.userId, actor.userId)).orderBy(asc(savedView.sortOrder)),
    db
      .select({ id: project.id })
      .from(projectMember)
      .innerJoin(user, eq(user.id, projectMember.userId))
      .innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))
      .innerJoin(project, eq(project.id, projectMember.projectId))
      .where(and(eq(projectMember.userId, actor.userId), isNull(project.archivedAt))),
  ]);
  const ids = new Set(visible.map((p) => p.id));
  return views.filter((v) => (v.projectId === null ? true : ids.has(v.projectId) && (!opts.projectId || v.projectId === opts.projectId)));
}

/** Renames one of the actor's views. @throws NotFoundError if it is not theirs */
export async function renameSavedView(db: Db, actor: Actor, id: string, name: string): Promise<void> {
  const clean = savedViewInput.shape.name.parse(name);
  await db.transaction(async (tx) => {
    await ownView(tx, actor, id);
    await tx.update(savedView).set({ name: clean }).where(eq(savedView.id, id));
  });
}

/** Deletes one of the actor's views. @throws NotFoundError if it is not theirs */
export async function deleteSavedView(db: Db, actor: Actor, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await ownView(tx, actor, id);
    await tx.delete(savedView).where(eq(savedView.id, id));
  });
}

/** Pins a view of the actor's to the sidebar or unpins it. @throws NotFoundError if it is not theirs */
export async function setSavedViewPinned(db: Db, actor: Actor, id: string, pinned: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await ownView(tx, actor, id);
    await tx.update(savedView).set({ pinned }).where(eq(savedView.id, id));
  });
}

/**
 * Puts the given views first, in this order.
 *
 * @throws InvalidError if an id is repeated or is not one of the actor's views
 */
export async function reorderSavedViews(db: Db, actor: Actor, orderedIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ id: savedView.id })
      .from(savedView)
      .where(and(eq(savedView.userId, actor.userId), inArray(savedView.id, orderedIds)))
      .for("update");
    if (new Set(orderedIds).size !== orderedIds.length || owned.length !== orderedIds.length) {
      throw new InvalidError("Some views to reorder do not exist.");
    }
    for (const [i, id] of orderedIds.entries()) await tx.update(savedView).set({ sortOrder: i }).where(eq(savedView.id, id));
  });
}
