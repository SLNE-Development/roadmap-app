import { and, asc, count, eq, inArray, isNotNull, isNull, max, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  adr,
  adrTask,
  board,
  boardColumn,
  COLUMN_CATEGORIES,
  domain,
  phase,
  planningItem,
  planningRound,
  PRIORITIES,
  question,
  system,
  task,
  taskCheck,
  user,
  type ColumnCategory,
  type Priority,
  type TaskEstimate,
  type TaskState,
} from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema, type AccessRole, type ProjectRow } from "./access";
import type { Actor } from "./actor";
import { dependencyMapsOf } from "./dependencies";
import { ConflictError, ForbiddenError, InvalidError, isUniqueViolation, NotFoundError, OpError } from "./errors";
import { fieldValuesByKey } from "./fields";
import { columnRulesOf, evaluateGates, gateMessage } from "./gates";
import { systemsWithFailingChecks } from "./github-links";
import { logChange } from "./log";
import { assertSystemActive, findBoard, findSystem, loadBoards, lockProject, userName, type BoardColumnRow, type BoardWithColumns, systemColumns, type SystemRow } from "./lookup";
import { isMember } from "./members";
import { notifyMentions, resolveMentionsIn } from "./mentions";
import { actorLabel } from "./notifications";
import { nullableEntityId } from "./params";
import { openAreaReopens, planningGaps } from "./planning";
import { systemRollups } from "./rollups";
import type { DomainRow, PhaseRow } from "./structure";

/** Longest system notes. */
const NOTES_MAX = 20000;

/** Input of {@link createSystem}. */
export const createSystemInput = z.object({
  slug: slugSchema,
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().max(2000).default(""),
  board: slugSchema.optional(),
  domainId: nullableEntityId.default(null),
  phaseId: nullableEntityId.default(null),
  priority: z.enum(PRIORITIES).default("Later"),
});

/** Filters of {@link listSystems}; `owner` is a user id or `none`; archived systems are left out unless `archived` says otherwise. */
export const systemFilter = z.object({
  board: z.string().optional(),
  domain: z.string().optional(),
  phase: z.string().optional(),
  category: z.enum(COLUMN_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  owner: z.string().optional(),
  startable: z.boolean().optional(),
  archived: z.enum(["exclude", "include", "only"]).default("exclude"),
});

/** Input of {@link updateSystem}; omitted fields stay unchanged. */
export const updateSystemInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(2000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerUserId: nullableEntityId.optional(),
  notes: z.string().max(NOTES_MAX).optional(),
  domainId: nullableEntityId.optional(),
  phaseId: nullableEntityId.optional(),
});

/** Input of {@link moveSystem}: a column id or name, on `board` or the current board; `overrideReason` lets an owner pass unmet column rules. */
export const moveSystemInput = z.object({
  board: slugSchema.optional(),
  column: z.string().trim().min(1),
  overrideReason: z.string().trim().min(3).max(500).optional(),
});

/** A system as listed in catalogues and boards. */
export interface SystemListItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  priority: Priority;
  boardSlug: string;
  boardName: string;
  columnId: string;
  columnName: string;
  columnCategory: ColumnCategory;
  domainId: string | null;
  phaseId: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  planningComplete: boolean;
  /** Planning areas (of 4) with at least one answered or accepted-risk item. */
  planningAreasCovered: number;
  /** Number of planning interview rounds recorded so far. */
  planningRounds: number;
  tasksTotal: number;
  tasksDone: number;
  tasksBlocked: number;
  points: number;
  pointsDone: number;
  unestimated: number;
  /** Unresolved questions about the system. */
  openQuestions: number;
  /** Slugs of the systems this one depends on. */
  dependsOn: string[];
  /** Slugs of the dependencies that are not in a done column yet. */
  blockedBy: string[];
  /** Custom field values by field key. */
  fields: Record<string, string>;
  /** An open pull request linked to the system has failing checks. */
  failingChecks: boolean;
  /** When the system was archived; null while active. */
  archivedAt: Date | null;
}

/** A task as shown on its system. */
export interface TaskItem {
  id: number;
  title: string;
  state: TaskState;
  priority: Priority;
  ownerUserId: string | null;
  ownerName: string | null;
  notes: string;
  blockedReason: string | null;
  estimate: TaskEstimate | null;
  planStep: number | null;
  checks: { id: string; title: string; done: boolean }[];
  /** Numbers of the ADRs linked to the task. */
  adrs: number[];
}

/** One system with its board, column, structure, owner and tasks. */
export interface SystemDetail {
  project: ProjectRow;
  role: AccessRole;
  system: SystemRow;
  board: BoardWithColumns;
  column: BoardColumnRow;
  domain: DomainRow | null;
  phase: PhaseRow | null;
  ownerName: string | null;
  tasks: TaskItem[];
}

/**
 * Returns the message of a blocked move out of planning, listing what is
 * still missing when `gaps` is given.
 */
export function planningGateMessage(systemSlug: string, gaps: string[]): string {
  const head = `System ${systemSlug} is still in planning. Finish the planning interview and call complete_planning first.`;
  return gaps.length ? `${head} Missing: ${gaps.join(" ")}` : head;
}

/**
 * Makes the actor the owner of a system that has none, logging the change.
 * Used when someone starts working on the system.
 */
export async function claimSystem(tx: Executor, actor: Actor, parent: SystemRow): Promise<void> {
  if (parent.ownerUserId !== null) return;
  const claimed = await tx
    .update(system)
    .set({ ownerUserId: actor.userId })
    .where(and(eq(system.id, parent.id), isNull(system.ownerUserId)))
    .returning({ id: system.id });
  if (claimed.length === 0) return;
  await logChange(tx, actor, {
    projectId: parent.projectId,
    systemId: parent.id,
    entity: "system",
    entityId: parent.id,
    field: "owner",
    oldValue: null,
    newValue: actor.name,
  });
}

/** Throws unless the domain and phase ids (when set) belong to the project. */
async function checkStructure(tx: Executor, projectId: string, domainId?: string | null, phaseId?: string | null): Promise<void> {
  if (domainId) {
    const rows = await tx.select({ id: domain.id }).from(domain).where(and(eq(domain.id, domainId), eq(domain.projectId, projectId)));
    if (rows.length === 0) throw new InvalidError(`Unknown domain ${domainId}.`);
  }
  if (phaseId) {
    const rows = await tx.select({ id: phase.id }).from(phase).where(and(eq(phase.id, phaseId), eq(phase.projectId, projectId)));
    if (rows.length === 0) throw new InvalidError(`Unknown phase ${phaseId}.`);
  }
}

/**
 * Creates a system in the planning column of `board` (default: the first board). Editor or higher.
 *
 * @throws ConflictError if the slug is taken in this project
 * @throws InvalidError if the domain or phase is not in this project
 */
export async function createSystem(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof createSystemInput>): Promise<SystemRow> {
  const input = createSystemInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const { project } = await projectAccess(tx, actor, projectSlug, "editor");
      const first = input.board ? await findBoard(tx, project.id, input.board) : (await loadBoards(tx, project.id))[0];
      if (!first) throw new NotFoundError(`Project ${projectSlug} has no board.`);
      // Share-lock the board so a concurrent column edit cannot delete the column used below.
      await tx.select({ id: board.id }).from(board).where(eq(board.id, first.id)).for("share");
      const target = await findBoard(tx, project.id, first.slug);
      const planning = target.columns.find((c) => c.category === "planning");
      if (!planning) throw new ConflictError(`Board ${target.slug} has no planning column.`);
      await checkStructure(tx, project.id, input.domainId, input.phaseId);
      await lockProject(tx, project.id);
      const [{ last }] = await tx.select({ last: max(system.sortOrder) }).from(system).where(eq(system.projectId, project.id));
      const [row] = await tx
        .insert(system)
        .values({
          id: newId(),
          projectId: project.id,
          boardId: target.id,
          columnId: planning.id,
          domainId: input.domainId,
          phaseId: input.phaseId,
          slug: input.slug,
          title: input.title,
          summary: input.summary,
          priority: input.priority,
          sortOrder: (last ?? -1) + 1,
        })
        .returning(systemColumns);
      await logChange(tx, actor, { projectId: project.id, systemId: row.id, entity: "system", entityId: row.id, field: "created", newValue: row.title });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`System slug ${input.slug} is taken in this project.`);
    throw error;
  }
}

/**
 * Lists the project's systems matching `filter`, by board order then system order, with task counts and planning progress.
 * `startable: true` keeps unfinished systems without unfinished dependencies, `false` those with some.
 */
export async function listSystems(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof systemFilter> = {},
): Promise<SystemListItem[]> {
  const filter = systemFilter.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const conditions: SQL[] = [eq(system.projectId, project.id)];
  if (filter.board) conditions.push(eq(board.slug, filter.board));
  if (filter.domain) conditions.push(eq(system.domainId, filter.domain));
  if (filter.phase) conditions.push(eq(system.phaseId, filter.phase));
  if (filter.category) conditions.push(eq(boardColumn.category, filter.category));
  if (filter.priority) conditions.push(eq(system.priority, filter.priority));
  if (filter.owner === "none") conditions.push(isNull(system.ownerUserId));
  else if (filter.owner) conditions.push(eq(system.ownerUserId, filter.owner));
  if (filter.archived === "exclude") conditions.push(isNull(system.archivedAt));
  else if (filter.archived === "only") conditions.push(isNotNull(system.archivedAt));

  const rows = await db
    .select({
      id: system.id,
      slug: system.slug,
      title: system.title,
      summary: system.summary,
      priority: system.priority,
      boardSlug: board.slug,
      boardName: board.name,
      columnId: boardColumn.id,
      columnName: boardColumn.name,
      columnCategory: boardColumn.category,
      domainId: system.domainId,
      phaseId: system.phaseId,
      ownerUserId: system.ownerUserId,
      ownerName: user.name,
      planningCompletedAt: system.planningCompletedAt,
      archivedAt: system.archivedAt,
    })
    .from(system)
    .innerJoin(board, eq(board.id, system.boardId))
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .leftJoin(user, eq(user.id, system.ownerUserId))
    .where(and(...conditions))
    .orderBy(asc(board.sortOrder), asc(system.sortOrder));

  const counts = await db
    .select({
      systemId: task.systemId,
      total: count(),
      done: sql<number>`count(*) filter (where ${task.state} = 'done')`.mapWith(Number),
      blocked: sql<number>`count(*) filter (where ${task.state} = 'blocked')`.mapWith(Number),
    })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(eq(system.projectId, project.id))
    .groupBy(task.systemId);
  const bySystem = new Map(counts.map((c) => [c.systemId, c]));

  // Archived systems listed on request need their rollups named explicitly.
  const rollups = await systemRollups(db, project.id, filter.archived === "exclude" ? undefined : rows.map((r) => r.id));

  const planning = await db
    .select({
      systemId: planningRound.systemId,
      rounds: sql<number>`count(distinct ${planningRound.id})`.mapWith(Number),
      areas: sql<number>`count(distinct ${planningItem.area}) filter (where ${planningItem.status} <> 'open')`.mapWith(Number),
    })
    .from(planningRound)
    .innerJoin(system, eq(system.id, planningRound.systemId))
    .leftJoin(planningItem, eq(planningItem.roundId, planningRound.id))
    .where(eq(system.projectId, project.id))
    .groupBy(planningRound.systemId);
  const planningBySystem = new Map(planning.map((p) => [p.systemId, p]));

  const questionCounts = await db
    .select({ systemId: question.systemId, open: count() })
    .from(question)
    .where(and(eq(question.projectId, project.id), eq(question.resolved, false), isNotNull(question.systemId)))
    .groupBy(question.systemId);
  const openQuestions = new Map(questionCounts.map((q) => [q.systemId, q.open]));

  const dependencies = await dependencyMapsOf(db, project.id);
  const fieldValues = await fieldValuesByKey(db, project.id);
  const failing = await systemsWithFailingChecks(db, project.id);

  const items = rows.map(({ planningCompletedAt, ...r }) => ({
    ...r,
    planningComplete: planningCompletedAt !== null,
    planningAreasCovered: planningBySystem.get(r.id)?.areas ?? 0,
    planningRounds: planningBySystem.get(r.id)?.rounds ?? 0,
    tasksTotal: bySystem.get(r.id)?.total ?? 0,
    tasksDone: bySystem.get(r.id)?.done ?? 0,
    tasksBlocked: bySystem.get(r.id)?.blocked ?? 0,
    points: rollups.get(r.id)?.points ?? 0,
    pointsDone: rollups.get(r.id)?.pointsDone ?? 0,
    unestimated: rollups.get(r.id)?.unestimated ?? 0,
    openQuestions: openQuestions.get(r.id) ?? 0,
    dependsOn: dependencies.dependsOn.get(r.id) ?? [],
    blockedBy: dependencies.blockedBy.get(r.id) ?? [],
    fields: fieldValues.get(r.id) ?? {},
    failingChecks: failing.has(r.id),
  }));
  if (filter.startable === undefined) return items;
  return items.filter((s) => (filter.startable ? s.blockedBy.length === 0 && s.columnCategory !== "done" : s.blockedBy.length > 0));
}

/** Returns one system with its board, column, domain, phase, owner and tasks. */
export async function getSystem(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<SystemDetail> {
  const found = await projectAccess(db, actor, projectSlug, "viewer");
  const row = await findSystem(db, found.project.id, systemSlug);
  const boards = await loadBoards(db, found.project.id);
  const currentBoard = boards.find((b) => b.id === row.boardId) as BoardWithColumns;
  const column = currentBoard.columns.find((c) => c.id === row.columnId) as BoardColumnRow;
  const [domainRow] = row.domainId ? await db.select().from(domain).where(eq(domain.id, row.domainId)) : [];
  const [phaseRow] = row.phaseId ? await db.select().from(phase).where(eq(phase.id, row.phaseId)) : [];
  const taskRows = await db
    .select({
      id: task.id,
      title: task.title,
      state: task.state,
      priority: task.priority,
      ownerUserId: task.ownerUserId,
      ownerName: user.name,
      notes: task.notes,
      blockedReason: task.blockedReason,
      estimate: task.estimate,
      planStep: task.planStep,
    })
    .from(task)
    .leftJoin(user, eq(user.id, task.ownerUserId))
    .where(eq(task.systemId, row.id))
    .orderBy(asc(task.sortOrder), asc(task.id));
  const checkRows = taskRows.length
    ? await db
        .select({ id: taskCheck.id, taskId: taskCheck.taskId, title: taskCheck.title, done: taskCheck.done })
        .from(taskCheck)
        .where(inArray(taskCheck.taskId, taskRows.map((t) => t.id)))
        .orderBy(asc(taskCheck.sortOrder))
    : [];
  const adrRows = taskRows.length
    ? await db
        .select({ taskId: adrTask.taskId, number: adr.number })
        .from(adrTask)
        .innerJoin(adr, eq(adr.id, adrTask.adrId))
        .where(inArray(adrTask.taskId, taskRows.map((t) => t.id)))
        .orderBy(asc(adr.number))
    : [];
  const tasks = taskRows.map((t) => ({
    ...t,
    checks: checkRows.filter((c) => c.taskId === t.id).map(({ id, title, done }) => ({ id, title, done })),
    adrs: adrRows.filter((a) => a.taskId === t.id).map((a) => a.number),
  }));
  return {
    ...found,
    system: row,
    board: currentBoard,
    column,
    domain: domainRow ?? null,
    phase: phaseRow ?? null,
    ownerName: await userName(db, row.ownerUserId),
    tasks,
  };
}

/**
 * Changes a system's fields and logs each changed one (the owner by name). Editor or higher.
 *
 * @throws InvalidError if the owner is not a project member, or the domain or phase is foreign
 */
export async function updateSystem(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof updateSystemInput>,
): Promise<SystemRow> {
  const patch = updateSystemInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findSystem(tx, project.id, systemSlug, true);
    return applySystemPatch(tx, actor, project, current, patch);
  });
}

/** Applies `patch` to the locked, active system `parent`, logging each changed field; returns the updated row. */
export async function applySystemPatch(
  tx: Executor,
  actor: Actor,
  project: ProjectRow,
  parent: SystemRow,
  raw: z.output<typeof updateSystemInput>,
): Promise<SystemRow> {
  const current = parent;
  const patch = raw.notes === undefined ? raw : { ...raw, notes: await resolveMentionsIn(tx, project.id, raw.notes, NOTES_MAX) };
  if (patch.ownerUserId && !(await isMember(tx, project.id, patch.ownerUserId))) {
    throw new InvalidError(`User ${patch.ownerUserId} is not a member of this project.`);
  }
  await checkStructure(tx, project.id, patch.domainId, patch.phaseId);
  const changes: Partial<SystemRow> = {};
  for (const field of ["title", "summary", "priority", "ownerUserId", "notes", "domainId", "phaseId"] as const) {
    const next = patch[field];
    if (next === undefined || next === current[field]) continue;
    Object.assign(changes, { [field]: next });
    const owner = field === "ownerUserId";
    await logChange(tx, actor, {
      projectId: project.id,
      systemId: current.id,
      entity: "system",
      entityId: current.id,
      field: owner ? "owner" : field,
      oldValue: owner ? await userName(tx, current.ownerUserId) : current[field],
      newValue: owner ? await userName(tx, next as string | null) : (next as string | null),
    });
  }
  if (Object.keys(changes).length === 0) return current;
  const [row] = await tx.update(system).set(changes).where(eq(system.id, current.id)).returning(systemColumns);
  if (changes.notes !== undefined) {
    await notifyMentions(tx, actor, {
      projectId: project.id,
      before: current.notes,
      after: row.notes,
      title: `${actorLabel(actor.name, actor.agent)} mentioned you in notes on ${row.title}`,
      href: `/p/${project.slug}/systems/${row.slug}`,
      source: `system:${row.id}:notes`,
    });
  }
  return row;
}

/**
 * Moves a system to a column (by id or case-insensitive name) of `board` or its
 * current board. Leaving the planning column requires completed planning, and
 * entering a column requires its entry rules to hold unless a project owner gives
 * `overrideReason`, which is logged. Moving into an `active` column makes the
 * actor (when a project member) owner of an unowned system. Editor or higher.
 *
 * @throws InvalidError if the board has no such column
 * @throws ConflictError if planning is not complete or the column's rules are unmet
 * @throws ForbiddenError if a non-owner passes `overrideReason` for unmet rules
 */
export async function moveSystem(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof moveSystemInput>,
): Promise<SystemRow> {
  const input = moveSystemInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project, role } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findSystem(tx, project.id, systemSlug, true);
    return applySystemMove(tx, actor, project, role, current, input);
  });
}

/** Moves the locked, active system `parent` as {@link moveSystem} describes, `role` being the actor's; returns the updated row. */
export async function applySystemMove(
  tx: Executor,
  actor: Actor,
  project: ProjectRow,
  role: AccessRole,
  parent: SystemRow,
  to: z.output<typeof moveSystemInput>,
): Promise<SystemRow> {
  const current = parent;
  const boards = await loadBoards(tx, project.id);
  const from = boards.find((b) => b.id === current.boardId) as BoardWithColumns;
  const toFirst = to.board ? await findBoard(tx, project.id, to.board) : from;
  // Share-lock the target board so a concurrent column or rule edit cannot change the column used below.
  await tx.select({ id: board.id }).from(board).where(eq(board.id, toFirst.id)).for("share");
  const target = await findBoard(tx, project.id, toFirst.slug);
  const wanted = to.column.toLowerCase();
  const column = target.columns.find((c) => c.id === to.column || c.name.toLowerCase() === wanted);
  if (!column) {
    throw new InvalidError(`Board ${target.slug} has no column "${to.column}". Columns: ${target.columns.map((c) => c.name).join(", ")}.`);
  }
  if (column.category !== "planning" && !current.planningCompletedAt) {
    throw new ConflictError(planningGateMessage(current.slug, await planningGaps(tx, current.id)));
  }
  if (column.id === current.columnId) return current;
  if (column.category === "done") {
    const reopened = await openAreaReopens(tx, current.id);
    if (reopened.length > 0) {
      throw new ConflictError(
        `System ${current.slug} has reopened planning areas: ${reopened.map((r) => r.area).join(", ")}. Complete them with complete_planning_area first.`,
      );
    }
  }
  const rules = (await columnRulesOf(tx, [column.id])).get(column.id) ?? [];
  const gate = (await evaluateGates(tx, [current], column.name, rules, new Date())).get(current.id);
  if (gate && gate.unmet.length > 0) {
    if (!to.overrideReason) throw new ConflictError(gateMessage(current.slug, gate));
    if (role !== "owner" && !actor.isAdmin) throw new ForbiddenError("Only project owners can override column rules.");
    await logChange(tx, actor, {
      projectId: project.id,
      systemId: current.id,
      entity: "system",
      entityId: current.id,
      field: "gateOverride",
      oldValue: gate.unmet.join("; "),
      newValue: `${column.name}: ${to.overrideReason}`,
    });
  }
  if (column.category === "active" && (await isMember(tx, project.id, actor.userId))) {
    await claimSystem(tx, actor, current);
  }
  const fromColumn = from.columns.find((c) => c.id === current.columnId);
  const [row] = await tx.update(system).set({ boardId: target.id, columnId: column.id }).where(eq(system.id, current.id)).returning(systemColumns);
  await logChange(tx, actor, {
    projectId: project.id,
    systemId: current.id,
    entity: "system",
    entityId: current.id,
    field: "column",
    oldValue: `${from.name} / ${fromColumn?.name}`,
    newValue: `${target.name} / ${column.name}`,
  });
  return row;
}

/** Input of {@link updateSystems}: the same changes applied to every listed system. */
export const updateSystemsInput = z.object({
  systems: z.array(slugSchema).min(1).max(100),
  patch: z
    .object({
      ownerUserId: nullableEntityId.optional(),
      phaseId: nullableEntityId.optional(),
      domainId: nullableEntityId.optional(),
      priority: z.enum(PRIORITIES).optional(),
      move: moveSystemInput.optional(),
    })
    .refine((p) => Object.values(p).some((v) => v !== undefined), "Choose at least one change."),
});

/**
 * Applies one patch, then the optional move, to every listed system in a single
 * transaction, so either all change or none do. Systems are locked in slug order
 * so two bulk edits never deadlock. Editor or higher. Part 5 decides whether agents get a batch variant.
 *
 * @throws ConflictError (InvalidError when every failure is a 400) naming every failing system; nothing is changed
 */
export async function updateSystems(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof updateSystemsInput>): Promise<{ updated: string[] }> {
  const input = updateSystemsInput.parse(raw);
  const slugs = [...new Set(input.systems)].sort();
  const { move, ...patch } = input.patch;
  return db.transaction(async (tx) => {
    const { project, role } = await projectAccess(tx, actor, projectSlug, "editor");
    const rows = await tx
      .select(systemColumns)
      .from(system)
      .where(and(eq(system.projectId, project.id), inArray(system.slug, slugs)))
      .orderBy(asc(system.slug))
      .for("no key update");
    const bySlug = new Map(rows.map((r) => [r.slug, r]));
    const failures: { text: string; status: number }[] = [];
    for (const slug of slugs) {
      const row = bySlug.get(slug);
      if (!row) {
        failures.push({ text: `${slug}: not found`, status: 404 });
        continue;
      }
      try {
        assertSystemActive(row);
        const patched = await applySystemPatch(tx, actor, project, row, patch);
        if (move) await applySystemMove(tx, actor, project, role, patched, move);
      } catch (error) {
        if (!(error instanceof OpError)) throw error;
        failures.push({ text: `${slug}: ${error.message}`, status: error.status });
      }
    }
    if (failures.length > 0) {
      const message = `Nothing was changed. ${failures.length} systems failed: ${failures.map((f) => f.text).join("; ")}`;
      throw failures.every((f) => f.status === 400) ? new InvalidError(message) : new ConflictError(message);
    }
    return { updated: slugs };
  });
}
