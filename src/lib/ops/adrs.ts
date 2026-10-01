import { and, asc, eq, inArray, max, type SQL } from "drizzle-orm";
import { z } from "zod";
import { adr, ADR_STATUSES, adrSystem, adrTask, changeLog, system, task, user, type AdrStatus, type TaskState } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { formatAdrNumber } from "@/lib/adr-number";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { assertSystemActive, findSystem, lockProject, systemColumns } from "./lookup";

/** A required ADR section. */
const section = z.string().trim().min(1).max(20000);

/** The ids of the tasks an ADR links to. */
const taskIds = z.array(z.number().int().positive().max(2147483647)).max(50);

/** Input of {@link createAdr}. */
export const createAdrInput = z.object({
  title: z.string().trim().min(1).max(200),
  context: section,
  decision: section,
  alternatives: section,
  consequences: section,
  systems: z.array(slugSchema).max(50).default([]),
  tasks: taskIds.default([]),
});

/** Input of {@link updateAdr}; omitted fields stay unchanged. */
export const updateAdrInput = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  context: section.optional(),
  decision: section.optional(),
  alternatives: section.optional(),
  consequences: section.optional(),
  systems: z.array(slugSchema).max(50).optional(),
  tasks: taskIds.optional(),
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

/** A task linked to an ADR. */
export interface AdrTask {
  id: number;
  title: string;
  state: TaskState;
  systemSlug: string;
}

/** One change-log entry of an ADR. */
export interface AdrHistoryEntry {
  at: Date;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  authorName: string | null;
  agent: string | null;
}

/** An ADR with its sections, linked tasks and history. */
export interface AdrDetail extends AdrSummary {
  context: string;
  decision: string;
  alternatives: string;
  consequences: string;
  tasks: AdrTask[];
  history: AdrHistoryEntry[];
}

/** At most this many history entries are returned. */
const HISTORY_LIMIT = 100;

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

/**
 * Replaces the systems linked to an ADR with the systems named by slug. A new
 * link to an archived system is refused; an existing one is kept.
 */
async function linkSystems(tx: Tx, projectId: string, adrId: string, slugs: string[]): Promise<void> {
  const existing = new Set((await tx.select({ id: adrSystem.systemId }).from(adrSystem).where(eq(adrSystem.adrId, adrId))).map((l) => l.id));
  await tx.delete(adrSystem).where(eq(adrSystem.adrId, adrId));
  for (const slug of new Set(slugs)) {
    const linked = await findSystem(tx, projectId, slug);
    if (!existing.has(linked.id)) assertSystemActive(linked);
    await tx.insert(adrSystem).values({ adrId, systemId: linked.id });
  }
}

/**
 * Replaces the tasks linked to an ADR and logs each added and removed link. Every
 * task must belong to a system of the project. A new link to a task of an archived
 * system is refused; an existing one is kept.
 *
 * @throws NotFoundError if a task is unknown or belongs to another project
 */
async function linkTasks(tx: Tx, actor: Actor, projectId: string, adrId: string, ids: number[]): Promise<void> {
  const wanted = [...new Set(ids)];
  const rows = wanted.length
    ? await tx
        .select({ id: task.id, parent: systemColumns })
        .from(task)
        .innerJoin(system, eq(system.id, task.systemId))
        .where(and(inArray(task.id, wanted), eq(system.projectId, projectId)))
    : [];
  for (const id of wanted) if (!rows.some((r) => r.id === id)) throw new NotFoundError(`Unknown task ${id}.`);
  const existing = new Set((await tx.select({ id: adrTask.taskId }).from(adrTask).where(eq(adrTask.adrId, adrId))).map((l) => l.id));
  for (const row of rows) if (!existing.has(row.id)) assertSystemActive(row.parent);
  await tx.delete(adrTask).where(eq(adrTask.adrId, adrId));
  if (wanted.length) await tx.insert(adrTask).values(wanted.map((taskId) => ({ adrId, taskId })));
  for (const id of wanted) {
    if (!existing.has(id)) await logChange(tx, actor, { projectId, entity: "adr", entityId: adrId, field: "task", newValue: `#${id}` });
  }
  for (const id of existing) {
    if (!wanted.includes(id)) await logChange(tx, actor, { projectId, entity: "adr", entityId: adrId, field: "task", oldValue: `#${id}` });
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
  const taskRows = await db
    .select({ adrId: adrTask.adrId, id: task.id, title: task.title, state: task.state, systemSlug: system.slug })
    .from(adrTask)
    .innerJoin(task, eq(task.id, adrTask.taskId))
    .innerJoin(system, eq(system.id, task.systemId))
    .where(inArray(adrTask.adrId, rows.map((r) => r.adr.id)))
    .orderBy(asc(task.id));
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
    tasks: taskRows.filter((t) => t.adrId === a.id).map(({ id, title, state, systemSlug }) => ({ id, title, state, systemSlug })),
    history: [],
  }));
}

/**
 * Creates a proposed ADR with the next number of the project. The project row is
 * locked so parallel writers get consecutive numbers. Editor or higher.
 */
export async function createAdr(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createAdrInput>): Promise<{ number: number }> {
  const { systems, tasks, ...input } = createAdrInput.parse(raw);
  return db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    await lockProject(tx, found.project.id);
    const [{ last }] = await tx.select({ last: max(adr.number) }).from(adr).where(eq(adr.projectId, found.project.id));
    const number = (last ?? 0) + 1;
    const id = newId();
    await tx.insert(adr).values({ id, projectId: found.project.id, number, ...input, authorUserId: actor.userId, agent: actor.agent ?? null });
    await linkSystems(tx, found.project.id, id, systems);
    await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: id, field: "created", newValue: `ADR ${formatAdrNumber(number)}: ${input.title}` });
    await linkTasks(tx, actor, found.project.id, id, tasks);
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
  const history = await db
    .select({ at: changeLog.createdAt, field: changeLog.field, oldValue: changeLog.oldValue, newValue: changeLog.newValue, authorName: user.name, agent: changeLog.agent })
    .from(changeLog)
    .innerJoin(adr, and(eq(changeLog.entity, "adr"), eq(changeLog.entityId, adr.id)))
    .leftJoin(user, eq(user.id, changeLog.authorUserId))
    .where(and(eq(adr.projectId, found.id), eq(adr.number, number)))
    .orderBy(asc(changeLog.id))
    .limit(HISTORY_LIMIT);
  return { ...row, history };
}

/** The project's tasks an ADR can link to, by system and position, at most 500. Viewer or higher. */
export async function linkableTasks(db: Executor, actor: Actor, projectSlug: string): Promise<{ id: number; title: string; systemSlug: string }[]> {
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  return db
    .select({ id: task.id, title: task.title, systemSlug: system.slug })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(eq(system.projectId, found.id))
    .orderBy(asc(system.slug), asc(task.sortOrder), asc(task.id))
    .limit(500);
}

/**
 * Edits an ADR. Its title and sections change only while it is proposed; the
 * linked systems and tasks may change at any status. The ADR row is locked so a
 * concurrent acceptance cannot slip between the status check and the write.
 * Editor or higher.
 *
 * @throws ConflictError if the title or a section changes on an accepted or superseded ADR
 */
export async function updateAdr(db: Db, actor: Actor, projectSlug: string, number: number, raw: z.input<typeof updateAdrInput>): Promise<void> {
  const { systems, tasks, ...patch } = updateAdrInput.parse(raw);
  await db.transaction(async (tx) => {
    const found = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findAdr(tx, found.project.id, number, true);
    if (current.status !== "proposed" && Object.values(patch).some((value) => value !== undefined)) {
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
    if (Object.keys(changed).length > 0) await tx.update(adr).set(changed).where(eq(adr.id, current.id));
    if (systemsChanged && systems) await linkSystems(tx, found.project.id, current.id, systems);
    if (fields.length > 0) await logChange(tx, actor, { projectId: found.project.id, entity: "adr", entityId: current.id, field: "edited", newValue: fields.join(", ") });
    if (tasks) await linkTasks(tx, actor, found.project.id, current.id, tasks);
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
