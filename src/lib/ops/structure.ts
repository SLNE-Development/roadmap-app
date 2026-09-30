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
  const parsed = phaseInput.parse(raw);
  const input = { ...parsed, dependsOn: [...new Set(parsed.dependsOn)] };
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

/** Input of {@link updateDomain}; omitted fields stay unchanged. */
export const updateDomainInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(500).optional(),
});

/** Input of {@link updatePhase}; omitted fields stay unchanged, `dependsOn` replaces all dependencies. */
export const updatePhaseInput = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  goal: z.string().trim().max(2000).optional(),
  dependsOn: z.array(z.string()).max(20).optional(),
});

/** Input of {@link reorderDomains} and {@link reorderPhases}: every id of the project, in the new order. */
export const reorderInput = z.object({ orderedIds: z.array(z.string().min(1)).min(1).max(500) });

/**
 * Checks that `orderedIds` names every one of `current` exactly once.
 *
 * @throws InvalidError on a missing, repeated or unknown id
 */
function checkPermutation(kind: "domain" | "phase", current: { id: string }[], orderedIds: string[]): void {
  const known = new Set(current.map((c) => c.id));
  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (!known.has(id)) throw new InvalidError(`Unknown ${kind} ${id}.`);
    if (seen.has(id)) throw new InvalidError(`The ${kind} ${id} is listed twice.`);
    seen.add(id);
  }
  if (seen.size !== known.size) throw new InvalidError(`List every ${kind} of the project exactly once.`);
}

/**
 * Changes a domain's name or description and logs each changed field. Editor or higher.
 *
 * @throws NotFoundError if the domain is not in this project
 */
export async function updateDomain(
  db: Db,
  actor: Actor,
  slug: string,
  id: string,
  raw: z.input<typeof updateDomainInput>,
): Promise<DomainRow> {
  const patch = updateDomainInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const [current] = await tx
      .select()
      .from(domain)
      .where(and(eq(domain.id, id), eq(domain.projectId, project.id)))
      .for("update");
    if (!current) throw new NotFoundError(`Unknown domain ${id}.`);
    const changes: Partial<DomainRow> = {};
    for (const field of ["name", "description"] as const) {
      const next = patch[field];
      if (next === undefined || next === current[field]) continue;
      changes[field] = next;
      await logChange(tx, actor, { projectId: project.id, entity: "domain", entityId: id, field, oldValue: current[field], newValue: next });
    }
    if (Object.keys(changes).length === 0) return current;
    const [row] = await tx.update(domain).set(changes).where(eq(domain.id, id)).returning();
    return row;
  });
}

/**
 * Puts the project's domains into the order of `orderedIds`, which must list
 * each of them exactly once, and logs every moved domain. Editor or higher.
 *
 * @throws InvalidError on a missing, repeated or unknown id
 */
export async function reorderDomains(db: Db, actor: Actor, slug: string, orderedIds: string[]): Promise<DomainRow[]> {
  const { orderedIds: ids } = reorderInput.parse({ orderedIds });
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const current = await tx.select().from(domain).where(eq(domain.projectId, project.id)).orderBy(asc(domain.sortOrder)).for("update");
    checkPermutation("domain", current, ids);
    for (const [index, id] of ids.entries()) {
      const before = current.findIndex((c) => c.id === id);
      if (before === index) continue;
      await tx.update(domain).set({ sortOrder: index }).where(eq(domain.id, id));
      await logChange(tx, actor, {
        projectId: project.id,
        entity: "domain",
        entityId: id,
        field: "position",
        oldValue: String(before + 1),
        newValue: String(index + 1),
      });
    }
    return tx.select().from(domain).where(eq(domain.projectId, project.id)).orderBy(asc(domain.sortOrder));
  });
}

/**
 * Returns the first phase of `dependsOn` from which `phaseId` is reachable
 * through `edges` (ignoring the edges of `phaseId` itself, which are being
 * replaced), i.e. a dependency that would close a cycle, or undefined.
 */
function findCycle(phaseId: string, dependsOn: string[], edges: { phaseId: string; dependsOnId: string }[]): string | undefined {
  const next = new Map<string, string[]>();
  for (const e of edges) {
    if (e.phaseId === phaseId) continue;
    next.set(e.phaseId, [...(next.get(e.phaseId) ?? []), e.dependsOnId]);
  }
  return dependsOn.find((start) => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length > 0) {
      const at = stack.pop() as string;
      if (at === phaseId) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(next.get(at) ?? []));
    }
    return false;
  });
}

/**
 * Changes a phase's name, goal or dependencies (replacing them all) and logs
 * each changed field, dependencies by phase name. Editor or higher.
 *
 * @throws NotFoundError if the phase is not in this project
 * @throws InvalidError if a dependency is foreign, the phase itself, or closes a cycle
 */
export async function updatePhase(
  db: Db,
  actor: Actor,
  slug: string,
  id: string,
  raw: z.input<typeof updatePhaseInput>,
): Promise<PhaseItem> {
  const parsed = updatePhaseInput.parse(raw);
  const dependsOn = parsed.dependsOn && [...new Set(parsed.dependsOn)];
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    // Lock every phase of the project so concurrent dependency edits cannot form a cycle together.
    const phases = await tx.select().from(phase).where(eq(phase.projectId, project.id)).orderBy(asc(phase.sortOrder)).for("update");
    const current = phases.find((p) => p.id === id);
    if (!current) throw new NotFoundError(`Unknown phase ${id}.`);
    const edges = await tx
      .select()
      .from(phaseDependency)
      .where(inArray(phaseDependency.phaseId, phases.map((p) => p.id)));
    const before = edges.filter((e) => e.phaseId === id).map((e) => e.dependsOnId);
    if (dependsOn) {
      const missing = dependsOn.find((d) => !phases.some((p) => p.id === d));
      if (missing) throw new InvalidError(`Unknown phase ${missing}.`);
      if (dependsOn.includes(id)) throw new InvalidError("A phase cannot depend on itself.");
      const closing = findCycle(id, dependsOn, edges);
      if (closing) {
        const name = phases.find((p) => p.id === closing)?.name;
        throw new InvalidError(`Phase ${name} already builds on ${current.name}; depending on it would create a cycle.`);
      }
    }

    const changes: Partial<PhaseRow> = {};
    for (const field of ["name", "goal"] as const) {
      const next = parsed[field];
      if (next === undefined || next === current[field]) continue;
      changes[field] = next;
      await logChange(tx, actor, { projectId: project.id, entity: "phase", entityId: id, field, oldValue: current[field], newValue: next });
    }
    const row = Object.keys(changes).length > 0 ? (await tx.update(phase).set(changes).where(eq(phase.id, id)).returning())[0] : current;

    const unchanged = !dependsOn || (dependsOn.length === before.length && dependsOn.every((d) => before.includes(d)));
    if (unchanged) return { ...row, dependsOn: before };
    await tx.delete(phaseDependency).where(eq(phaseDependency.phaseId, id));
    if (dependsOn.length > 0) await tx.insert(phaseDependency).values(dependsOn.map((d) => ({ phaseId: id, dependsOnId: d })));
    /** Names of the given phases in phase order, or null for none. */
    const names = (ids: string[]) =>
      phases
        .filter((p) => ids.includes(p.id))
        .map((p) => p.name)
        .join(", ") || null;
    await logChange(tx, actor, { projectId: project.id, entity: "phase", entityId: id, field: "dependsOn", oldValue: names(before), newValue: names(dependsOn) });
    return { ...row, dependsOn };
  });
}

/**
 * Puts the project's phases into the order of `orderedIds`, which must list
 * each of them exactly once, and logs every moved phase. Editor or higher.
 *
 * @throws InvalidError on a missing, repeated or unknown id
 */
export async function reorderPhases(db: Db, actor: Actor, slug: string, orderedIds: string[]): Promise<PhaseRow[]> {
  const { orderedIds: ids } = reorderInput.parse({ orderedIds });
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, slug, "editor");
    const current = await tx.select().from(phase).where(eq(phase.projectId, project.id)).orderBy(asc(phase.sortOrder)).for("update");
    checkPermutation("phase", current, ids);
    for (const [index, id] of ids.entries()) {
      const before = current.findIndex((c) => c.id === id);
      if (before === index) continue;
      await tx.update(phase).set({ sortOrder: index }).where(eq(phase.id, id));
      await logChange(tx, actor, {
        projectId: project.id,
        entity: "phase",
        entityId: id,
        field: "position",
        oldValue: String(before + 1),
        newValue: String(index + 1),
      });
    }
    return tx.select().from(phase).where(eq(phase.projectId, project.id)).orderBy(asc(phase.sortOrder));
  });
}
