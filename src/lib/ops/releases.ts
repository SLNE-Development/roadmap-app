import { and, asc, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { adr, adrSystem, boardColumn, COLUMN_CATEGORIES, question, release, releaseNote, system, task, user, type ColumnCategory } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { Projection } from "@/lib/insight/burnup";
import { composeReleaseNotes } from "@/lib/insight/release-notes";
import { newId } from "@/lib/id";
import { rollup, type Rollup } from "@/lib/rollup";
import { projectAccess, slugSchema, type AccessRole, type ProjectRow } from "./access";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, isUniqueViolation, NotFoundError } from "./errors";
import { columnRulesOf, evaluateGates, type GateSubject } from "./gates";
import { getProgress } from "./insight";
import { logChange } from "./log";
import type { SystemRow } from "./lookup";
import { latestUpdates } from "./updates";

/** A release row. */
export type ReleaseRow = typeof release.$inferSelect;

/** Input of {@link createRelease}. */
export const createReleaseInput = z.object({
  slug: slugSchema,
  name: z.string().trim().min(1).max(80),
  targetDate: z.iso.date().nullable().optional(),
});

/** Input of {@link updateRelease}; omitted fields stay unchanged. */
export const updateReleaseInput = z.object({
  slug: slugSchema.optional(),
  name: z.string().trim().min(1).max(80).optional(),
  targetDate: z.iso.date().nullable().optional(),
});

/** Whether the role may manage owner-only parts of a release. */
function isOwnerRole(role: AccessRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Returns the release with `slug` in the project, optionally locking its row
 * until the surrounding transaction ends.
 *
 * @throws NotFoundError if there is none
 */
export async function findRelease(tx: Executor, projectId: string, slug: string, lock = false): Promise<ReleaseRow> {
  const query = tx
    .select()
    .from(release)
    .where(and(eq(release.projectId, projectId), eq(release.slug, slug)))
    .limit(1);
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw new NotFoundError(`Unknown release ${slug}.`);
  return row;
}

/**
 * Creates a planned release. Editor or higher.
 *
 * @throws ConflictError if the slug is taken in this project
 */
export async function createRelease(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createReleaseInput>): Promise<ReleaseRow> {
  const input = createReleaseInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project } = await projectAccess(tx, actor, projectSlug, "editor");
      const [row] = await tx
        .insert(release)
        .values({ id: newId(), projectId: project.id, slug: input.slug, name: input.name, targetDate: input.targetDate ?? null })
        .returning();
      await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: row.id, field: "created", newValue: row.name });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Release slug ${input.slug} is taken in this project.`);
    throw error;
  }
}

/**
 * Changes a release's slug, name or target date, logging each change. Editor or
 * higher; renaming or re-dating a frozen release needs an owner and a shipped one is fixed.
 *
 * @throws ForbiddenError if a frozen release is changed by a non-owner
 * @throws ConflictError if the release is shipped or the slug is taken
 */
export async function updateRelease(
  db: Db,
  actor: Actor,
  projectSlug: string,
  releaseSlug: string,
  raw: z.input<typeof updateReleaseInput>,
): Promise<ReleaseRow> {
  const patch = updateReleaseInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project, role } = await projectAccess(tx, actor, projectSlug, "editor");
      const current = await findRelease(tx, project.id, releaseSlug, true);
      const changes: Partial<Pick<ReleaseRow, "slug" | "name" | "targetDate">> = {};
      for (const field of ["slug", "name", "targetDate"] as const) {
        const next = patch[field];
        if (next === undefined || next === current[field]) continue;
        Object.assign(changes, { [field]: next });
      }
      if (Object.keys(changes).length === 0) return current;
      if (current.status === "shipped") throw new ConflictError(`${current.name} is shipped; it can no longer change.`);
      if (current.status === "frozen" && !isOwnerRole(role)) {
        throw new ForbiddenError(`${current.name} is frozen; only an owner can change its name, slug or target date.`);
      }
      const [row] = await tx.update(release).set(changes).where(eq(release.id, current.id)).returning();
      for (const field of Object.keys(changes) as (keyof typeof changes)[]) {
        await logChange(tx, actor, {
          projectId: project.id,
          entity: "release",
          entityId: current.id,
          field,
          oldValue: current[field],
          newValue: row[field],
        });
      }
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`Release slug ${patch.slug} is taken in this project.`);
    throw error;
  }
}

/**
 * Freezes a planned release: from then on only owners change its scope. Owner only.
 *
 * @throws ConflictError if the release is not planned
 */
export async function freezeRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string): Promise<ReleaseRow> {
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    if (current.status !== "planned") throw new ConflictError(`${current.name} is ${current.status}; only a planned release can be frozen.`);
    const [row] = await tx.update(release).set({ status: "frozen", frozenAt: new Date() }).where(eq(release.id, current.id)).returning();
    await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: current.id, field: "status", oldValue: "planned", newValue: "frozen" });
    return row;
  });
}

/**
 * Returns a frozen release to planned, so editors can change its scope again. Owner only.
 *
 * @throws ConflictError if the release is not frozen
 */
export async function unfreezeRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string): Promise<ReleaseRow> {
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    if (current.status !== "frozen") throw new ConflictError(`${current.name} is ${current.status}; only a frozen release can be unfrozen.`);
    const [row] = await tx.update(release).set({ status: "planned", frozenAt: null }).where(eq(release.id, current.id)).returning();
    await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: current.id, field: "status", oldValue: "frozen", newValue: "planned" });
    return row;
  });
}

/**
 * Deletes a planned release; its systems become unassigned. Owner only.
 *
 * @throws ConflictError if the release is frozen or shipped
 */
export async function deleteRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    if (current.status !== "planned") throw new ConflictError(`${current.name} is ${current.status}; only a planned release can be deleted.`);
    await tx.delete(release).where(eq(release.id, current.id));
    await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: current.id, field: "deleted", oldValue: current.name });
  });
}

/** The outcome of {@link assignRelease}: the new release id and the names to log. */
export interface ReleaseAssignment {
  releaseId: string | null;
  from: string | null;
  to: string | null;
}

/**
 * Checks and resolves moving `system` into the release `slug` (`null` removes it
 * from its release), locking the previous and the target release rows so a
 * freeze and an assignment serialise. Returns `null` when nothing changes.
 *
 * @throws NotFoundError if the release is unknown
 * @throws ConflictError if the previous or target release is shipped
 * @throws ForbiddenError if either is frozen and the actor is no owner
 */
export async function assignRelease(
  tx: Executor,
  actor: Actor,
  project: ProjectRow,
  system: SystemRow,
  slug: string | null,
): Promise<ReleaseAssignment | null> {
  const target = slug === null ? null : await findRelease(tx, project.id, slug);
  if ((target?.id ?? null) === system.releaseId) return null;
  const { role } = await projectAccess(tx, actor, project.slug, "editor");
  // Lock in id order so two assignments crossing the same releases never deadlock.
  const ids = [...new Set([system.releaseId, target?.id].filter((id): id is string => Boolean(id)))].sort();
  const locked = new Map<string, ReleaseRow>();
  for (const id of ids) {
    const [row] = await tx.select().from(release).where(eq(release.id, id)).for("update");
    if (row) locked.set(id, row);
  }
  const previous = system.releaseId ? locked.get(system.releaseId) : undefined;
  const next = target ? locked.get(target.id) : undefined;
  if (target && !next) throw new NotFoundError(`Unknown release ${target.slug}.`);
  for (const row of [previous, next]) {
    if (!row) continue;
    if (row.status === "shipped") throw new ConflictError(`${row.name} is shipped; its scope can no longer change.`);
    if (row.status === "frozen" && !isOwnerRole(role)) throw new ForbiddenError(`${row.name} is frozen; only an owner can change its scope.`);
  }
  return { releaseId: next?.id ?? null, from: previous?.name ?? null, to: next?.name ?? null };
}

/** How a release is doing against its target date. */
export type ReleaseRisk = "on-track" | "at-risk" | "late" | "unknown";

/**
 * Judges a release against its target: a shipped release is on track; without a target or a
 * projected range it is unknown; it is on track when the latest projected finish meets the
 * target, late when even the earliest misses it, otherwise at risk.
 */
export function releaseRisk(status: ReleaseRow["status"], targetDate: string | null, projection: Projection): ReleaseRisk {
  if (status === "shipped" || projection.status === "done") return "on-track";
  if (!targetDate || projection.status !== "range") return "unknown";
  if (projection.latest <= targetDate) return "on-track";
  if (projection.earliest > targetDate) return "late";
  return "at-risk";
}

/** A system of a release as {@link getRelease} lists it. */
export interface ReleaseSystem {
  slug: string;
  title: string;
  category: ColumnCategory;
  ownerName: string | null;
  tasksDone: number;
  tasksTotal: number;
  /** Failing rules of the board's first done column. */
  gatesUnmet: number;
  /** How many rules the board's first done column has. */
  gatesTotal: number;
}

/** A release with its scope, readiness and slip risk. */
export interface ReleaseDetail {
  release: ReleaseRow;
  systems: ReleaseSystem[];
  counts: Record<ColumnCategory, number>;
  estimates: Rollup;
  openQuestions: { id: string; title: string; priority: string; systemSlug: string }[];
  risk: ReleaseRisk;
  projection: Projection;
  latestNote: { version: number; body: string } | null;
}

/** The active systems of a release with their column category and owner name. */
async function systemsOf(tx: Executor, releaseId: string) {
  return tx
    .select({
      id: system.id,
      slug: system.slug,
      title: system.title,
      summary: system.summary,
      boardId: system.boardId,
      category: boardColumn.category,
      ownerName: user.name,
    })
    .from(system)
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .leftJoin(user, eq(user.id, system.ownerUserId))
    .where(and(eq(system.releaseId, releaseId), isNull(system.archivedAt)))
    .orderBy(asc(system.sortOrder), asc(system.title));
}

/**
 * Returns a release with its systems, per-category counts, estimate rollup, open questions,
 * slip risk against its target and newest note. Viewer or higher.
 *
 * @param now the end of the burn-up window, injectable for tests
 * @throws NotFoundError if the project or release is unknown
 */
export async function getRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string, now: Date = new Date()): Promise<ReleaseDetail> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const row = await findRelease(db, project.id, releaseSlug);
  const members = await systemsOf(db, row.id);
  const ids = members.map((m) => m.id);
  const tasks = ids.length ? await db.select({ systemId: task.systemId, state: task.state, estimate: task.estimate }).from(task).where(inArray(task.systemId, ids)) : [];
  const gates = new Map<string, { unmet: number; total: number }>();
  for (const boardId of new Set(members.map((m) => m.boardId))) {
    const [done] = await db
      .select({ id: boardColumn.id, name: boardColumn.name })
      .from(boardColumn)
      .where(and(eq(boardColumn.boardId, boardId), eq(boardColumn.category, "done")))
      .orderBy(asc(boardColumn.sortOrder))
      .limit(1);
    if (!done) continue;
    const rules = (await columnRulesOf(db, [done.id])).get(done.id) ?? [];
    const subjects: GateSubject[] = members.filter((m) => m.boardId === boardId).map((m) => ({ id: m.id, slug: m.slug, projectId: project.id }));
    for (const [id, result] of await evaluateGates(db, subjects, done.name, rules, now)) gates.set(id, { unmet: result.unmet.length, total: result.total });
  }
  const counts = Object.fromEntries(COLUMN_CATEGORIES.map((c) => [c, 0])) as Record<ColumnCategory, number>;
  for (const m of members) counts[m.category] += 1;
  const questions = ids.length
    ? await db
        .select({ id: question.id, title: question.title, priority: question.priority, systemId: question.systemId })
        .from(question)
        .where(and(inArray(question.systemId, ids), eq(question.resolved, false)))
        .orderBy(asc(question.createdAt))
    : [];
  const slugById = new Map(members.map((m) => [m.id, m.slug]));
  const { projection } = await getProgress(db, actor, projectSlug, { release: releaseSlug }, now);
  const [note] = await db
    .select({ version: releaseNote.version, body: releaseNote.body })
    .from(releaseNote)
    .where(eq(releaseNote.releaseId, row.id))
    .orderBy(desc(releaseNote.version))
    .limit(1);
  return {
    release: row,
    systems: members.map((m) => {
      const own = rollup(tasks.filter((t) => t.systemId === m.id));
      return { slug: m.slug, title: m.title, category: m.category, ownerName: m.ownerName, tasksDone: own.done, tasksTotal: own.tasks, gatesUnmet: gates.get(m.id)?.unmet ?? 0, gatesTotal: gates.get(m.id)?.total ?? 0 };
    }),
    counts,
    estimates: rollup(tasks),
    openQuestions: questions.map((q) => ({ id: q.id, title: q.title, priority: q.priority, systemSlug: slugById.get(q.systemId as string) as string })),
    risk: releaseRisk(row.status, row.targetDate, projection),
    projection,
    latestNote: note ?? null,
  };
}

/** A release in a list, with how many systems it holds and how many of them are done. */
export type ReleaseListItem = ReleaseRow & { systemCount: number; doneCount: number };

/** Lists the project's releases ordered by target date (none last), then name. Viewer or higher. */
export async function listReleases(db: Db, actor: Actor, projectSlug: string): Promise<ReleaseListItem[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const rows = await db.select().from(release).where(eq(release.projectId, project.id));
  const members = await db
    .select({ releaseId: system.releaseId, category: boardColumn.category })
    .from(system)
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .where(and(eq(system.projectId, project.id), isNull(system.archivedAt)));
  return rows
    .map((r) => {
      const mine = members.filter((m) => m.releaseId === r.id);
      return { ...r, systemCount: mine.length, doneCount: mine.filter((m) => m.category === "done").length };
    })
    .sort((a, b) => {
      if (a.targetDate !== b.targetDate) return a.targetDate === null ? 1 : b.targetDate === null ? -1 : a.targetDate < b.targetDate ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

/** Input of {@link shipRelease}: what to do with systems that are not done. */
export const shipReleaseInput = z.object({ unfinished: z.enum(["block", "unassign"]).default("block") });

/** Appends the next version of the release's notes; the caller holds the release row lock. */
async function appendNote(tx: Executor, actor: Actor, projectId: string, current: ReleaseRow, body: string): Promise<number> {
  const [{ last }] = await tx.select({ last: max(releaseNote.version) }).from(releaseNote).where(eq(releaseNote.releaseId, current.id));
  const version = (last ?? 0) + 1;
  await tx.insert(releaseNote).values({ id: newId(), releaseId: current.id, version, body, authorUserId: actor.userId, agent: actor.agent ?? null });
  await logChange(tx, actor, { projectId, entity: "release", entityId: current.id, field: "notes", newValue: `v${version}` });
  return version;
}

/**
 * Ships a planned or frozen release: its done systems are shipped, and unfinished ones either
 * block it or are moved out of it (each move logged). Writes version 1 of its notes. Owner only.
 *
 * @throws ConflictError if it is already shipped, or has unfinished systems and `unfinished` is `block`
 */
export async function shipRelease(db: Db, actor: Actor, projectSlug: string, releaseSlug: string, raw: z.input<typeof shipReleaseInput>): Promise<ReleaseRow> {
  const input = shipReleaseInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "owner");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    if (current.status === "shipped") throw new ConflictError(`${current.name} is already shipped.`);
    const members = await systemsOf(tx, current.id);
    const unfinished = members.filter((m) => m.category !== "done");
    if (unfinished.length > 0 && input.unfinished === "block") {
      throw new ConflictError(
        `${unfinished.length} of ${members.length} systems aren't done: ${unfinished.map((m) => m.title).join(", ")}. Ship with unfinished: unassign to move them out.`,
      );
    }
    for (const m of unfinished) {
      await tx.update(system).set({ releaseId: null }).where(eq(system.id, m.id));
      await logChange(tx, actor, { projectId: project.id, systemId: m.id, entity: "system", entityId: m.id, field: "release", oldValue: current.name, newValue: null });
    }
    const shippedAt = new Date();
    const [row] = await tx.update(release).set({ status: "shipped", shippedAt }).where(eq(release.id, current.id)).returning();
    await logChange(tx, actor, { projectId: project.id, entity: "release", entityId: current.id, field: "status", oldValue: current.status, newValue: "shipped" });

    const shipped = members.filter((m) => m.category === "done");
    const updates = await latestUpdates(tx, project.id);
    const decisions = shipped.length
      ? await tx
          .selectDistinct({ number: adr.number, title: adr.title })
          .from(adr)
          .innerJoin(adrSystem, eq(adrSystem.adrId, adr.id))
          .where(
            and(
              eq(adr.status, "accepted"),
              inArray(
                adrSystem.systemId,
                shipped.map((m) => m.id),
              ),
            ),
          )
          .orderBy(asc(adr.number))
      : [];
    const body = composeReleaseNotes({
      name: current.name,
      shippedOn: shippedAt.toISOString().slice(0, 10),
      shipped: shipped.map((m) => ({ title: m.title, summary: m.summary, lastUpdate: updates.get(m.id)?.summary ?? null })),
      decisions,
      notShipped: unfinished.map((m) => ({ title: m.title })),
    });
    await appendNote(tx, actor, project.id, current, body);
    return row;
  });
}

/** Writes a new version of a release's notes, also on a shipped release. Editor or higher. */
export async function writeReleaseNote(db: Db, actor: Actor, projectSlug: string, releaseSlug: string, body: string): Promise<{ version: number }> {
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findRelease(tx, project.id, releaseSlug, true);
    return { version: await appendNote(tx, actor, project.id, current, body) };
  });
}

/**
 * Returns a version of a release's notes, the newest when `version` is omitted. Viewer or higher.
 *
 * @throws NotFoundError if the release has no such version
 */
export async function getReleaseNote(
  db: Db,
  actor: Actor,
  projectSlug: string,
  releaseSlug: string,
  version?: number,
): Promise<{ version: number; body: string; createdAt: Date }> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const current = await findRelease(db, project.id, releaseSlug);
  const [row] = await db
    .select({ version: releaseNote.version, body: releaseNote.body, createdAt: releaseNote.createdAt })
    .from(releaseNote)
    .where(and(eq(releaseNote.releaseId, current.id), version === undefined ? undefined : eq(releaseNote.version, version)))
    .orderBy(desc(releaseNote.version))
    .limit(1);
  if (!row) throw new NotFoundError(version === undefined ? `${current.name} has no notes.` : `${current.name} has no notes version ${version}.`);
  return row;
}
