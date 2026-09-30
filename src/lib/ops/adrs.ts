import { and, asc, eq, inArray, max, type SQL } from "drizzle-orm";
import { z } from "zod";
import { adr, ADR_STATUSES, adrSystem, system, user, type AdrStatus } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { formatAdrNumber } from "@/lib/adr-number";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem, lockProject } from "./lookup";

/** A required ADR section. */
const section = z.string().trim().min(1).max(20000);

/** Input of {@link createAdr}. */
export const createAdrInput = z.object({
  title: z.string().trim().min(1).max(200),
  context: section,
  decision: section,
  alternatives: section,
  consequences: section,
  systems: z.array(slugSchema).max(50).default([]),
});

/** Input of {@link updateAdr}; omitted fields stay unchanged. */
export const updateAdrInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  context: section.optional(),
  decision: section.optional(),
  alternatives: section.optional(),
  consequences: section.optional(),
  systems: z.array(slugSchema).max(50).optional(),
});

/** Filters of {@link listAdrs}. */
export const adrFilter = z.object({ status: z.enum(ADR_STATUSES).optional(), system: z.string().optional() });

/** An ADR as listed, with its author split into person and agent. */
export interface AdrSummary extends AuthorFields {
  number: number;
  title: string;
  status: AdrStatus;
  createdAt: Date;
  acceptedAt: Date | null;
  supersedes: number | null;
  supersededBy: number | null;
  systems: string[];
}

/** An ADR with its sections. */
export interface AdrDetail extends AdrSummary {
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
}

/** Re-exported for the ops' callers; client code imports it from `@/lib/adr-number`. */
export { formatAdrNumber };

/** Loads the ADR with `number` in the project, optionally locked, or throws `NotFoundError`. */
async function findAdr(tx: Executor, projectId: string, number: number, lock = false) {
  const query = tx
    .select()
    .from(adr)
    .where(and(eq(adr.projectId, projectId), eq(adr.number, number)))
    .limit(1);
  const [row] = lock ? await query.for("no key update") : await query;
  if (!row) throw new NotFoundError(`Unknown ADR ${formatAdrNumber(number)}.`);
  return row;
}

/** Replaces the systems linked to an ADR with the systems named by slug. */
async function linkSystems(tx: Tx, projectId: string, adrId: string, slugs: string[]): Promise<void> {
  await tx.delete(adrSystem).where(eq(adrSystem.adrId, adrId));
  for (const slug of new Set(slugs)) {
    const linked = await findSystem(tx, projectId, slug);
    await tx.insert(adrSystem).values({ adrId, systemId: linked.id });
  }
}

/**
 * Loads summaries (and sections) of ADRs matching `where`, ordered by number;
 * `systemId` keeps only the ADRs linked to that system.
 */
async function loadAdrs(db: Executor, projectId: string, where?: SQL, systemId?: string): Promise<AdrDetail[]> {
  const base = db.select({ adr, authorName: user.name }).from(adr).leftJoin(user, eq(user.id, adr.authorUserId));
  const scoped = systemId ? base.innerJoin(adrSystem, and(eq(adrSystem.adrId, adr.id), eq(adrSystem.systemId, systemId))) : base;
  const rows = await scoped
    .where(where ? and(eq(adr.projectId, projectId), where) : eq(adr.projectId, projectId))
    .orderBy(asc(adr.number));
  if (rows.length === 0) return [];
  const numbers = new Map(
    (await db.select({ id: adr.id, number: adr.number }).from(adr).where(eq(adr.projectId, projectId))).map((r) => [r.id, r.number]),
  );
  const links = await db
    .select({ adrId: adrSystem.adrId, slug: system.slug })
    .from(adrSystem)
    .innerJoin(system, eq(system.id, adrSystem.systemId))
    .where(inArray(adrSystem.adrId, rows.map((r) => r.adr.id)))
    .orderBy(asc(system.slug));
  return rows.map(({ adr: a, authorName }) => ({
    number: a.number,
    title: a.title,
    status: a.status,
    ...authorFields(authorName, a.agent),
    createdAt: a.createdAt,
    acceptedAt: a.acceptedAt,
    supersedes: a.supersedesId ? (numbers.get(a.supersedesId) ?? null) : null,
    supersededBy: a.supersededById ? (numbers.get(a.supersededById) ?? null) : null,
    systems: links.filter((l) => l.adrId === a.id).map((l) => l.slug),
    context: a.context,
    decision: a.decision,
    alternatives: a.alternatives,
    consequences: a.consequences,
  }));
}

/**
 * Creates a proposed ADR with the next number of the project. The project row is
 * locked so parallel writers get consecutive numbers. Editor or higher.
 */
export async function createAdr(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createAdrInput>): Promise<{ number: number }> {
  const { systems, ...input } = createAdrInput.parse(raw);
  return db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    await lockProject(tx, found.project.id);
    const [{ last }] = await tx.select({ last: max(adr.number) }).from(adr).where(eq(adr.projectId, found.project.id));
    const number = (last ?? 0) + 1;
    const id = newId();
    await tx.insert(adr).values({ id, projectId: found.project.id, number, ...input, authorUserId: actor.userId, agent: actor.agent ?? null });
    await linkSystems(tx, found.project.id, id, systems);
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: id, field: "created", newValue: `ADR ${formatAdrNumber(number)}: ${input.title}` });
    return { number };
  });
}

/** Lists the project's ADRs by number, optionally by status or linked system. */
export async function listAdrs(db: Executor, actor: Actor, projectSlug: string, raw: z.input<typeof adrFilter> = {}): Promise<AdrSummary[]> {
  const filter = adrFilter.parse(raw);
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  const systemId = filter.system ? (await findSystem(db, found.id, filter.system)).id : undefined;
  return adrsOf(db, found.id, { status: filter.status, systemId });
}

/** {@link listAdrs} for a project and system the caller already resolved; performs no access check. */
export async function adrsOf(db: Executor, projectId: string, filter: { status?: AdrStatus; systemId?: string }): Promise<AdrSummary[]> {
  const all = await loadAdrs(db, projectId, filter.status ? eq(adr.status, filter.status) : undefined, filter.systemId);
  return all.map((a) => ({
    number: a.number,
    title: a.title,
    status: a.status,
    author: a.author,
    authorName: a.authorName,
    agent: a.agent,
    createdAt: a.createdAt,
    acceptedAt: a.acceptedAt,
    supersedes: a.supersedes,
    supersededBy: a.supersededBy,
    systems: a.systems,
  }));
}

/** Returns one ADR with its sections. */
export async function getAdr(db: Executor, actor: Actor, projectSlug: string, number: number): Promise<AdrDetail> {
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  const [row] = await loadAdrs(db, found.id, eq(adr.number, number));
  if (!row) throw new NotFoundError(`Unknown ADR ${formatAdrNumber(number)}.`);
  return row;
}

/**
 * Edits a proposed ADR. The ADR row is locked so a concurrent acceptance cannot
 * slip between the status check and the write. Editor or higher.
 *
 * @throws ConflictError if the ADR is accepted or superseded
 */
export async function updateAdr(db: Db, actor: Actor, projectSlug: string, number: number, raw: z.input<typeof updateAdrInput>): Promise<void> {
  const { systems, ...patch } = updateAdrInput.parse(raw);
  await db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findAdr(tx, found.project.id, number, true);
    if (current.status !== "proposed") {
      throw new ConflictError(`ADR ${formatAdrNumber(number)} is ${current.status} and can no longer be edited; write a new ADR that supersedes it.`);
    }
    const changed = Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== current[key as keyof typeof patch]));
    const linked = systems
      ? (await tx.select({ slug: system.slug }).from(adrSystem).innerJoin(system, eq(system.id, adrSystem.systemId)).where(eq(adrSystem.adrId, current.id)))
          .map((l) => l.slug)
          .sort()
      : [];
    const systemsChanged = systems !== undefined && [...new Set(systems)].sort().join(",") !== linked.join(",");
    const fields = [...Object.keys(changed), ...(systemsChanged ? ["systems"] : [])];
    if (fields.length === 0) return;
    if (Object.keys(changed).length > 0) await tx.update(adr).set(changed).where(eq(adr.id, current.id));
    if (systemsChanged && systems) await linkSystems(tx, found.project.id, current.id, systems);
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: current.id, field: "edited", newValue: fields.join(", ") });
  });
}

/**
 * Accepts a proposed ADR; from then on it is immutable. The ADR row is locked so
 * two writers cannot both pass the status check. Editor or higher.
 *
 * @throws ConflictError if it is not proposed
 */
export async function acceptAdr(db: Db, actor: Actor, projectSlug: string, number: number): Promise<void> {
  await db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findAdr(tx, found.project.id, number, true);
    if (current.status !== "proposed") throw new ConflictError(`ADR ${formatAdrNumber(number)} is already ${current.status}.`);
    await tx.update(adr).set({ status: "accepted", acceptedAt: new Date() }).where(eq(adr.id, current.id));
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: current.id, field: "status", oldValue: "proposed", newValue: "accepted" });
  });
}

/**
 * Marks accepted ADR `number` as superseded by accepted ADR `by`, linking both.
 * No section of either ADR changes. Both rows are locked in ascending number
 * order so concurrent supersessions cannot deadlock or both pass the checks.
 * Editor or higher.
 *
 * @throws InvalidError if both numbers are the same
 * @throws ConflictError if either ADR is not accepted or `by` already supersedes another
 */
export async function supersedeAdr(db: Db, actor: Actor, projectSlug: string, input: { number: number; by: number }): Promise<void> {
  if (input.number === input.by) throw new InvalidError("An ADR cannot supersede itself.");
  await db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    const [first, second] = input.number < input.by ? [input.number, input.by] : [input.by, input.number];
    const low = await findAdr(tx, found.project.id, first, true);
    const high = await findAdr(tx, found.project.id, second, true);
    const old = input.number === first ? low : high;
    const next = input.by === first ? low : high;
    if (old.status !== "accepted") throw new ConflictError(`ADR ${formatAdrNumber(input.number)} is ${old.status}; only accepted ADRs can be superseded.`);
    if (next.status !== "accepted") throw new ConflictError(`ADR ${formatAdrNumber(input.by)} must be accepted before it can supersede another.`);
    if (next.supersedesId) throw new ConflictError(`ADR ${formatAdrNumber(input.by)} already supersedes another ADR.`);
    await tx.update(adr).set({ status: "superseded", supersededById: next.id }).where(eq(adr.id, old.id));
    await tx.update(adr).set({ supersedesId: old.id }).where(eq(adr.id, next.id));
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: old.id, field: "status", oldValue: "accepted", newValue: `superseded by ${formatAdrNumber(input.by)}` });
  });
}
