import { and, asc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { domain, phase, phaseDependency } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";

/** A domain row. */
export type DomainRow = typeof domain.$inferSelect;

/** A phase row. */
export type PhaseRow = typeof phase.$inferSelect;

/** A phase with the ids of the phases it builds on. */
export interface PhaseItem extends PhaseRow {
  dependsOn: string[];
}

/** Input of {@link createDomain}. */
export const domainInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).default(""),
});

/** Input of {@link createPhase}. */
export const phaseInput = z.object({
  name: z.string().trim().min(1).max(60),
  goal: z.string().trim().max(2000).default(""),
  dependsOn: z.array(z.string()).max(20).default([]),
});

/** Lists the project's domains in order. */
export async function listDomains(db: Executor, actor: Actor, slug: string): Promise<DomainRow[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  return db.select().from(domain).where(eq(domain.projectId, project.id)).orderBy(asc(domain.sortOrder));
}

/** Adds a domain after the existing ones. Editor or higher. */
export async function createDomain(db: Db, actor: Actor, slug: string, raw: z.input<typeof domainInput>): Promise<DomainRow> {
  const input = domainInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const [{ last }] = await tx.select({ last: max(domain.sortOrder) }).from(domain).where(eq(domain.projectId, project.id));
    const [row] = await tx
      .insert(domain)
      .values({ id: newId(), projectId: project.id, ...input, sortOrder: (last ?? -1) + 1 })
      .returning();
    await logChange(tx, actor, { projectId: project.id, entity: "domain", entityId: row.id, field: "created", newValue: row.name });
    return row;
  });
}

/** Deletes a domain; its systems keep existing without a domain. Editor or higher. */
export async function deleteDomain(db: Db, actor: Actor, slug: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const deleted = await tx
      .delete(domain)
      .where(and(eq(domain.id, id), eq(domain.projectId, project.id)))
      .returning({ name: domain.name });
    if (deleted.length === 0) throw new NotFoundError(`Unknown domain ${id}.`);
    await logChange(tx, actor, { projectId: project.id, entity: "domain", entityId: id, field: "deleted", oldValue: deleted[0].name });
  });
}

/** Lists the project's phases in order with their dependencies. */
export async function listPhases(db: Executor, actor: Actor, slug: string): Promise<PhaseItem[]> {
  const { project } = await projectAccess(db, actor, slug, "viewer");
  const phases = await db.select().from(phase).where(eq(phase.projectId, project.id)).orderBy(asc(phase.sortOrder));
  if (phases.length === 0) return [];
  const deps = await db
    .select()
    .from(phaseDependency)
    .where(inArray(phaseDependency.phaseId, phases.map((p) => p.id)));
  return phases.map((p) => ({ ...p, dependsOn: deps.filter((d) => d.phaseId === p.id).map((d) => d.dependsOnId) }));
}

/**
 * Adds a phase after the existing ones. Editor or higher.
 *
 * @throws InvalidError if a dependency is not a phase of this project
 */
export async function createPhase(db: Db, actor: Actor, slug: string, raw: z.input<typeof phaseInput>): Promise<PhaseItem> {
  const input = phaseInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    if (input.dependsOn.length > 0) {
      const found = await tx
        .select({ id: phase.id })
        .from(phase)
        .where(and(eq(phase.projectId, project.id), inArray(phase.id, input.dependsOn)));
      const missing = input.dependsOn.find((id) => !found.some((f) => f.id === id));
      if (missing) throw new InvalidError(`Unknown phase ${missing}.`);
    }
    const [{ last }] = await tx.select({ last: max(phase.sortOrder) }).from(phase).where(eq(phase.projectId, project.id));
    const [row] = await tx
      .insert(phase)
      .values({ id: newId(), projectId: project.id, name: input.name, goal: input.goal, sortOrder: (last ?? -1) + 1 })
      .returning();
    if (input.dependsOn.length > 0) {
      await tx.insert(phaseDependency).values(input.dependsOn.map((d) => ({ phaseId: row.id, dependsOnId: d })));
    }
    await logChange(tx, actor, { projectId: project.id, entity: "phase", entityId: row.id, field: "created", newValue: row.name });
    return { ...row, dependsOn: input.dependsOn };
  });
}

/** Deletes a phase and its dependency edges; its systems keep existing without a phase. Editor or higher. */
export async function deletePhase(db: Db, actor: Actor, slug: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const deleted = await tx
      .delete(phase)
      .where(and(eq(phase.id, id), eq(phase.projectId, project.id)))
      .returning({ name: phase.name });
    if (deleted.length === 0) throw new NotFoundError(`Unknown phase ${id}.`);
    await logChange(tx, actor, { projectId: project.id, entity: "phase", entityId: id, field: "deleted", oldValue: deleted[0].name });
  });
}
