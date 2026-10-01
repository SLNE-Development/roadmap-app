import { eq } from "drizzle-orm";
import { project, system } from "@/db/schema";
import type { Db } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { logChange } from "./log";
import { findSystem, lockProject } from "./lookup";

/** Archives or restores a project, logging the change when the state flips. Owner only. */
async function setProjectArchived(db: Db, actor: Actor, slug: string, archived: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const { project: found } = await projectAccess(tx, actor, slug, "owner", { allowArchived: true });
    await lockProject(tx, found.id);
    const [current] = await tx.select({ archivedAt: project.archivedAt }).from(project).where(eq(project.id, found.id));
    if ((current.archivedAt !== null) === archived) return;
    await tx.update(project).set({ archivedAt: archived ? new Date() : null }).where(eq(project.id, found.id));
    await logChange(tx, actor, { projectId: found.id, entity: "project", entityId: found.id, field: "archived", oldValue: String(!archived), newValue: String(archived) });
  });
}

/** Archives a project: it leaves the default lists and refuses writes until restored. Owner only. */
export async function archiveProject(db: Db, actor: Actor, slug: string): Promise<void> {
  await setProjectArchived(db, actor, slug, true);
}

/** Restores an archived project so it is listed and writable again. Owner only. */
export async function restoreProject(db: Db, actor: Actor, slug: string): Promise<void> {
  await setProjectArchived(db, actor, slug, false);
}

/**
 * Archives a system (hidden from lists, boards and rollups, and read-only) or
 * restores it, logging the change when the state flips. Its slug stays taken.
 * Editor or higher; the project itself must not be archived.
 */
export async function setSystemArchived(db: Db, actor: Actor, projectSlug: string, systemSlug: string, archived: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const { project: found } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findSystem(tx, found.id, systemSlug, true, { allowArchived: true });
    if ((current.archivedAt !== null) === archived) return;
    await tx.update(system).set({ archivedAt: archived ? new Date() : null }).where(eq(system.id, current.id));
    await logChange(tx, actor, {
      projectId: found.id,
      systemId: current.id,
      entity: "system",
      entityId: current.id,
      field: "archived",
      oldValue: String(!archived),
      newValue: String(archived),
    });
  });
}
