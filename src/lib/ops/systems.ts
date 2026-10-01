import { and, asc, count, eq, isNull, max, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  board,
  boardColumn,
  COLUMN_CATEGORIES,
  domain,
  phase,
  planningItem,
  planningRound,
  PRIORITIES,
  system,
  task,
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
import { ConflictError, InvalidError, isUniqueViolation, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findBoard, findSystem, loadBoards, lockProject, userName, type BoardColumnRow, type BoardWithColumns, type SystemRow } from "./lookup";
import { isMember } from "./members";
import { nullableEntityId } from "./params";
import { planningGaps } from "./planning";
import { systemRollups } from "./rollups";
import type { DomainRow, PhaseRow } from "./structure";

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

/** Filters of {@link listSystems}; `owner` is a user id or `none`. */
export const systemFilter = z.object({
  board: z.string().optional(),
  domain: z.string().optional(),
  phase: z.string().optional(),
  category: z.enum(COLUMN_CATEGORIES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  owner: z.string().optional(),
});

/** Input of {@link updateSystem}; omitted fields stay unchanged. */
export const updateSystemInput = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  summary: z.string().trim().max(2000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  ownerUserId: nullableEntityId.optional(),
  notes: z.string().max(20000).optional(),
  domainId: nullableEntityId.optional(),
  phaseId: nullableEntityId.optional(),
});

/** Input of {@link moveSystem}: a column id or name, on `board` or the current board. */
export const moveSystemInput = z.object({ board: slugSchema.optional(), column: z.string().trim().min(1) });

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
        .returning();
      await logChange(tx, actor, { projectId: project.id, systemId: row.id, entity: "system", entityId: row.id, field: "created", newValue: row.title });
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`System slug ${input.slug} is taken in this project.`);
    throw error;
  }
}

/** Lists the project's systems matching `filter`, by board order then system order, with task counts and planning progress. */
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

  const rollups = await systemRollups(db, project.id);

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

  return rows.map(({ planningCompletedAt, ...r }) => ({
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
  }));
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
  const tasks = await db
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
    const [row] = await tx.update(system).set(changes).where(eq(system.id, current.id)).returning();
    return row;
  });
}

/**
 * Moves a system to a column (by id or case-insensitive name) of `board` or its
 * current board. Leaving the planning column requires completed planning. Moving
 * into an `active` column makes the actor (when a project member) owner of an
 * unowned system. Editor or higher.
 *
 * @throws InvalidError if the board has no such column
 * @throws ConflictError if planning is not complete
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
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findSystem(tx, project.id, systemSlug, true);
    const boards = await loadBoards(tx, project.id);
    const from = boards.find((b) => b.id === current.boardId) as BoardWithColumns;
    const toFirst = input.board ? await findBoard(tx, project.id, input.board) : from;
    // Share-lock the target board so a concurrent column edit cannot delete the column used below.
    await tx.select({ id: board.id }).from(board).where(eq(board.id, toFirst.id)).for("share");
    const to = await findBoard(tx, project.id, toFirst.slug);
    const wanted = input.column.toLowerCase();
    const column = to.columns.find((c) => c.id === input.column || c.name.toLowerCase() === wanted);
    if (!column) {
      throw new InvalidError(`Board ${to.slug} has no column "${input.column}". Columns: ${to.columns.map((c) => c.name).join(", ")}.`);
    }
    if (column.category !== "planning" && !current.planningCompletedAt) {
      throw new ConflictError(planningGateMessage(current.slug, await planningGaps(tx, current.id)));
    }
    if (column.id === current.columnId) return current;
    if (column.category === "active" && (await isMember(tx, project.id, actor.userId))) {
      await claimSystem(tx, actor, current);
    }
    const fromColumn = from.columns.find((c) => c.id === current.columnId);
    const [row] = await tx.update(system).set({ boardId: to.id, columnId: column.id }).where(eq(system.id, current.id)).returning();
    await logChange(tx, actor, {
      projectId: project.id,
      systemId: current.id,
      entity: "system",
      entityId: current.id,
      field: "column",
      oldValue: `${from.name} / ${fromColumn?.name}`,
      newValue: `${to.name} / ${column.name}`,
    });
    return row;
  });
}
