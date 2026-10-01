import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { boardColumn, system, systemDependency, type ColumnCategory } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { projectAccess, slugSchema } from "./access";
import type { Actor } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem } from "./lookup";

/** Input of {@link setDependencies}: the slugs of the systems this one depends on, at most 20. */
export const setDependenciesInput = z.object({ dependsOn: z.array(slugSchema).max(20) });

/** A system at the other end of a dependency. */
export interface DependencyRef {
  slug: string;
  title: string;
  columnCategory: ColumnCategory;
}

/** The dependencies of one system and the systems that depend on it. */
export interface SystemDependencies {
  dependsOn: DependencyRef[];
  dependents: DependencyRef[];
}

/**
 * Maps each system of the project to the slugs of the systems it depends on
 * (`dependsOn`) and of those not yet in a `done` column (`blockedBy`), in one query.
 * An archived dependency never blocks.
 */
export async function dependencyMapsOf(
  db: Executor,
  projectId: string,
): Promise<{ dependsOn: Map<string, string[]>; blockedBy: Map<string, string[]> }> {
  const target = alias(system, "target");
  const rows = await db
    .select({ systemId: systemDependency.systemId, slug: target.slug, category: boardColumn.category, archivedAt: target.archivedAt })
    .from(systemDependency)
    .innerJoin(system, eq(system.id, systemDependency.systemId))
    .innerJoin(target, eq(target.id, systemDependency.dependsOnId))
    .innerJoin(boardColumn, eq(boardColumn.id, target.columnId))
    .where(eq(system.projectId, projectId))
    .orderBy(asc(target.slug));
  const dependsOn = new Map<string, string[]>();
  const blockedBy = new Map<string, string[]>();
  for (const row of rows) {
    dependsOn.set(row.systemId, [...(dependsOn.get(row.systemId) ?? []), row.slug]);
    if (row.category !== "done" && !row.archivedAt) blockedBy.set(row.systemId, [...(blockedBy.get(row.systemId) ?? []), row.slug]);
  }
  return { dependsOn, blockedBy };
}

/** Maps a system id to the slugs of the systems it depends on that are not archived and not in a `done` column. */
export async function blockedByOf(db: Executor, projectId: string): Promise<Map<string, string[]>> {
  return (await dependencyMapsOf(db, projectId)).blockedBy;
}

/** Returns the systems `systemId` depends on and the systems depending on it, each by slug. */
export async function dependenciesOf(db: Executor, systemId: string): Promise<SystemDependencies> {
  const ref = { slug: system.slug, title: system.title, columnCategory: boardColumn.category };
  const dependsOn = await db
    .select(ref)
    .from(systemDependency)
    .innerJoin(system, eq(system.id, systemDependency.dependsOnId))
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .where(eq(systemDependency.systemId, systemId))
    .orderBy(asc(system.slug));
  const dependents = await db
    .select(ref)
    .from(systemDependency)
    .innerJoin(system, eq(system.id, systemDependency.systemId))
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .where(eq(systemDependency.dependsOnId, systemId))
    .orderBy(asc(system.slug));
  return { dependsOn, dependents };
}

/**
 * Returns the slugs of a dependency path from one of `targets` back to
 * `systemId` (ignoring the edges of `systemId` itself, which are being
 * replaced), or undefined when no target leads back.
 */
async function findCyclePath(tx: Executor, systemId: string, targets: string[]): Promise<string[] | undefined> {
  const result = await tx.execute(sql`
    with recursive walk(id, path) as (
      select s.id, array[s.slug] from ${system} s where s.id in (${sql.join(targets.map((t) => sql`${t}`), sql`, `)})
      union all
      select d.depends_on_id, w.path || n.slug
      from walk w
      join ${systemDependency} d on d.system_id = w.id
      join ${system} n on n.id = d.depends_on_id
      where w.id <> ${systemId} and not n.slug = any(w.path)
    )
    select path from walk where id = ${systemId} order by array_length(path, 1), path limit 1
  `);
  // postgres-js returns the rows themselves, PGlite wraps them.
  const rows = (Array.isArray(result) ? result : (result as unknown as { rows: unknown[] }).rows) as { path: string[] }[];
  return rows[0]?.path;
}

/**
 * Replaces the set of systems `systemSlug` depends on and logs each added and
 * removed dependency by slug. Editor or higher.
 *
 * @throws NotFoundError if a slug is not a system of this project
 * @throws InvalidError if the system depends on itself
 * @throws ConflictError if a new dependency would close a cycle, or if the system is archived
 */
export async function setDependencies(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof setDependenciesInput>,
): Promise<{ dependsOn: string[] }> {
  const input = setDependenciesInput.parse(raw);
  const wanted = [...new Set(input.dependsOn)];
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    // Serialises the project's dependency writes so two writers cannot close a cycle between them.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`deps:${project.id}`}))`);
    const current = await findSystem(tx, project.id, systemSlug, true);
    if (wanted.includes(current.slug)) throw new InvalidError("A system cannot depend on itself.");
    const targets = wanted.length
      ? await tx.select({ id: system.id, slug: system.slug }).from(system).where(and(eq(system.projectId, project.id), inArray(system.slug, wanted)))
      : [];
    const missing = wanted.find((slug) => !targets.some((t) => t.slug === slug));
    if (missing) throw new NotFoundError(`Unknown system ${missing}.`);

    const existing = await tx
      .select({ id: systemDependency.dependsOnId, slug: system.slug })
      .from(systemDependency)
      .innerJoin(system, eq(system.id, systemDependency.dependsOnId))
      .where(eq(systemDependency.systemId, current.id))
      .orderBy(asc(system.slug));
    const added = wanted.map((slug) => targets.find((t) => t.slug === slug)!).filter((t) => !existing.some((e) => e.id === t.id));
    const removed = existing.filter((e) => !targets.some((t) => t.id === e.id));

    if (added.length > 0) {
      const path = await findCyclePath(tx, current.id, added.map((t) => t.id));
      if (path) throw new ConflictError(`Dependency cycle: ${[current.slug, ...path].join(" → ")}.`);
    }
    if (removed.length > 0) {
      await tx.delete(systemDependency).where(and(eq(systemDependency.systemId, current.id), inArray(systemDependency.dependsOnId, removed.map((e) => e.id))));
    }
    if (added.length > 0) await tx.insert(systemDependency).values(added.map((t) => ({ systemId: current.id, dependsOnId: t.id })));
    const entry = { projectId: project.id, systemId: current.id, entity: "dependency" };
    for (const e of removed) await logChange(tx, actor, { ...entry, entityId: `${current.id}:${e.id}`, field: "deleted", oldValue: e.slug });
    for (const t of added) await logChange(tx, actor, { ...entry, entityId: `${current.id}:${t.id}`, field: "created", newValue: t.slug });
    return { dependsOn: wanted };
  });
}
