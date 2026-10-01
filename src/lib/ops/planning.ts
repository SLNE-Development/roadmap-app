import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import {
  board,
  PLANNING_AREAS,
  planningAreaReopen,
  planningItem,
  planningRound,
  question,
  system,
  systemDocument,
  user,
  type PlanningArea,
  type PlanningItemStatus,
} from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { planningCoverage, type AreaCoverage } from "@/lib/planning-coverage";
import { projectAccess } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { ConflictError, InvalidError, NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem, loadBoards, systemAccess, type SystemRow } from "./lookup";

/** One question of a planning round. */
export const planningItemInput = z.object({
  area: z.enum(PLANNING_AREAS),
  question: z.string().trim().min(1).max(2000),
  isRisk: z.boolean().default(false),
});

/** Input of {@link addPlanningRound}. */
export const addRoundInput = z.object({ items: z.array(planningItemInput).min(1).max(20) });

/** Input of {@link answerPlanningItems}; `accepted-risk` is allowed only for flagged risks. */
export const answerItemsInput = z.object({
  answers: z
    .array(
      z.object({
        itemId: z.string().min(1),
        answer: z.string().trim().min(1).max(5000),
        status: z.enum(["answered", "accepted-risk"]).default("answered"),
      }),
    )
    .min(1)
    .max(50),
});

/** Input of {@link completePlanning}: the user's own words confirming the spec. */
export const completePlanningInput = z.object({ userConfirmation: z.string().trim().min(1).max(2000) });

/** Input of {@link reopenPlanningArea}. */
export const reopenAreaInput = z.object({ area: z.enum(PLANNING_AREAS), reason: z.string().trim().min(3).max(1000) });

/** Input of {@link completePlanningArea}: the user's own words confirming the area. */
export const completeAreaInput = z.object({ area: z.enum(PLANNING_AREAS), userConfirmation: z.string().trim().min(1).max(2000) });

/** A planning question as shown. */
export interface PlanningItemView {
  id: string;
  area: PlanningArea;
  question: string;
  answer: string | null;
  isRisk: boolean;
  status: PlanningItemStatus;
}

/** A planning round with its questions and its author split into person and agent. */
export interface PlanningRoundView extends AuthorFields {
  number: number;
  createdAt: Date;
  items: PlanningItemView[];
}

/** The whole planning interview of a system and what still blocks its completion. */
export interface PlanningView {
  completedAt: Date | null;
  confirmation: string | null;
  rounds: PlanningRoundView[];
  gaps: string[];
  coverage: AreaCoverage[];
  warnings: string[];
  reopenedAreas: { area: PlanningArea; reason: string; reopenedAt: Date }[];
}

/** Returns a question shortened to 80 characters for messages. */
function short(text: string): string {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Loads every round of a system with its items, in order. */
async function loadRounds(db: Executor, systemId: string): Promise<PlanningRoundView[]> {
  const rounds = await db
    .select({ id: planningRound.id, number: planningRound.number, createdAt: planningRound.createdAt, agent: planningRound.agent, authorName: user.name })
    .from(planningRound)
    .leftJoin(user, eq(user.id, planningRound.authorUserId))
    .where(eq(planningRound.systemId, systemId))
    .orderBy(asc(planningRound.number));
  if (rounds.length === 0) return [];
  const items = await db
    .select()
    .from(planningItem)
    .where(inArray(planningItem.roundId, rounds.map((r) => r.id)))
    .orderBy(asc(planningItem.sortOrder));
  return rounds.map((r) => ({
    number: r.number,
    createdAt: r.createdAt,
    ...authorFields(r.authorName, r.agent),
    items: items
      .filter((i) => i.roundId === r.id)
      .map((i) => ({ id: i.id, area: i.area, question: i.question, answer: i.answer, isRisk: i.isRisk, status: i.status })),
  }));
}

/**
 * Returns what still prevents completing each system's planning, in this order:
 * areas without an answered or accepted item, open items, a missing spec, and
 * unresolved blocking questions of systems that are not archived.
 * Uses one query each for rounds, items, specs and questions however many systems.
 *
 * @param systemIds the systems to check
 * @returns the gaps keyed by system id, an empty list for a system with none
 */
export async function planningGapsFor(db: Executor, systemIds: string[]): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (systemIds.length === 0) return result;
  const rounds = await db
    .select({ id: planningRound.id, systemId: planningRound.systemId })
    .from(planningRound)
    .where(inArray(planningRound.systemId, systemIds))
    .orderBy(asc(planningRound.number));
  const items =
    rounds.length === 0
      ? []
      : await db
          .select()
          .from(planningItem)
          .where(inArray(planningItem.roundId, rounds.map((r) => r.id)))
          .orderBy(asc(planningItem.sortOrder));
  const specs = await db
    .select({ systemId: systemDocument.systemId })
    .from(systemDocument)
    .where(and(inArray(systemDocument.systemId, systemIds), eq(systemDocument.kind, "spec")));
  const withSpec = new Set(specs.map((d) => d.systemId));
  const blocking = await db
    .select({ id: question.id, title: question.title, systemId: question.systemId })
    .from(question)
    .innerJoin(system, eq(system.id, question.systemId))
    .where(and(inArray(question.systemId, systemIds), eq(question.priority, "blocking"), eq(question.resolved, false), isNull(system.archivedAt)))
    .orderBy(asc(question.createdAt), asc(question.id));
  for (const systemId of systemIds) {
    const roundIds = rounds.filter((r) => r.systemId === systemId).map((r) => r.id);
    const own = roundIds.flatMap((id) => items.filter((i) => i.roundId === id));
    const gaps: string[] = [];
    for (const area of PLANNING_AREAS) {
      if (!own.some((i) => i.area === area && i.status !== "open")) gaps.push(`Area ${area} has no answered item.`);
    }
    for (const item of own.filter((i) => i.status === "open")) gaps.push(`Item ${item.id} is still open: "${short(item.question)}".`);
    if (!withSpec.has(systemId)) gaps.push("No spec has been written; call write_spec.");
    for (const q of blocking.filter((b) => b.systemId === systemId)) gaps.push(`Question ${q.id} is blocking: "${short(q.title)}".`);
    result.set(systemId, gaps);
  }
  return result;
}

/**
 * Returns what still prevents completing a system's planning, in this order:
 * areas without an answered or accepted item, open items, a missing spec, and
 * unresolved blocking questions.
 */
export async function planningGaps(db: Executor, systemId: string): Promise<string[]> {
  return (await planningGapsFor(db, [systemId])).get(systemId) ?? [];
}

/** Returns the areas of a system that are reopened and not yet completed again, oldest first. */
export async function openAreaReopens(db: Executor, systemId: string): Promise<{ area: PlanningArea; reason: string; reopenedAt: Date }[]> {
  return db
    .select({ area: planningAreaReopen.area, reason: planningAreaReopen.reason, reopenedAt: planningAreaReopen.reopenedAt })
    .from(planningAreaReopen)
    .where(and(eq(planningAreaReopen.systemId, systemId), isNull(planningAreaReopen.closedAt)))
    .orderBy(asc(planningAreaReopen.reopenedAt), asc(planningAreaReopen.area));
}

/**
 * Throws unless the system's planning accepts writes to items of `areas`: planning is
 * not complete, or every one of the areas is reopened.
 */
async function assertWritable(tx: Tx, parent: SystemRow, areas: PlanningArea[]): Promise<void> {
  if (!parent.planningCompletedAt) return;
  const reopened = await openAreaReopens(tx, parent.id);
  if (reopened.length === 0) throw new ConflictError(`Planning of system ${parent.slug} is complete; call reopen_planning to change it.`);
  const offending = areas.find((a) => !reopened.some((r) => r.area === a));
  if (offending) throw new InvalidError(`Only reopened areas can get new questions: ${offending} is not reopened.`);
}

/** Locks and returns a system for a planning write, checking the editor role. */
async function lockForPlanning(tx: Tx, actor: Actor, projectSlug: string, systemSlug: string): Promise<SystemRow> {
  const { project } = await projectAccess(tx, actor, projectSlug, "editor");
  return findSystem(tx, project.id, systemSlug, true);
}

/** Returns a system's planning interview, completion state, remaining gaps and per-area coverage. */
export async function getPlanning(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<PlanningView> {
  const { system: parent } = await systemAccess(db, actor, projectSlug, systemSlug, "viewer");
  return planningOf(db, parent);
}

/** {@link getPlanning} for a system the caller already resolved; performs no access check. */
export async function planningOf(db: Executor, parent: SystemRow): Promise<PlanningView> {
  const rounds = await loadRounds(db, parent.id);
  const coverage = planningCoverage(rounds.flatMap((r) => r.items));
  return {
    completedAt: parent.planningCompletedAt,
    confirmation: parent.planningConfirmation,
    rounds,
    gaps: parent.planningCompletedAt ? [] : await planningGaps(db, parent.id),
    coverage,
    warnings: parent.planningCompletedAt ? [] : coverage.filter((c) => c.thin).map((c) => `Area ${c.area} is thin: ${c.reason}`),
    reopenedAreas: await openAreaReopens(db, parent.id),
  };
}

/**
 * Records the next round of planning questions before they are asked. Editor or higher.
 *
 * @throws ConflictError if planning is complete and no area is reopened
 * @throws InvalidError for an item of an area that is not reopened while planning is complete
 */
export async function addPlanningRound(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof addRoundInput>,
): Promise<{ round: number; itemIds: string[] }> {
  const input = addRoundInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    await assertWritable(tx, parent, input.items.map((i) => i.area));
    const [{ last }] = await tx.select({ last: max(planningRound.number) }).from(planningRound).where(eq(planningRound.systemId, parent.id));
    const round = (last ?? 0) + 1;
    const roundId = newId();
    await tx.insert(planningRound).values({ id: roundId, systemId: parent.id, number: round, authorUserId: actor.userId, agent: actor.agent ?? null });
    const itemIds = input.items.map(() => newId());
    await tx.insert(planningItem).values(input.items.map((item, i) => ({ id: itemIds[i], roundId, ...item, sortOrder: i })));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "round", newValue: `round ${round}: ${input.items.length} questions` });
    return { round, itemIds };
  });
}

/**
 * Stores the user's answers to planning items of this system. Editor or higher.
 *
 * @throws NotFoundError for an item of another system
 * @throws InvalidError when accepting a risk on an item that is not flagged as one
 * @throws ConflictError if planning is complete and no area is reopened
 * @throws InvalidError for an item of an area that is not reopened while planning is complete
 */
export async function answerPlanningItems(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof answerItemsInput>,
): Promise<{ answered: number }> {
  const input = answerItemsInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    const ids = input.answers.map((a) => a.itemId);
    const found = await tx
      .select({ id: planningItem.id, isRisk: planningItem.isRisk, area: planningItem.area })
      .from(planningItem)
      .innerJoin(planningRound, eq(planningRound.id, planningItem.roundId))
      .where(and(eq(planningRound.systemId, parent.id), inArray(planningItem.id, ids)));
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const a of input.answers) {
      if (!byId.has(a.itemId)) throw new NotFoundError(`Unknown planning item ${a.itemId}.`);
    }
    await assertWritable(tx, parent, found.map((f) => f.area));
    for (const a of input.answers) {
      const item = byId.get(a.itemId)!;
      if (a.status === "accepted-risk" && !item.isRisk) {
        throw new InvalidError(`Item ${a.itemId} is not a flagged risk; answer it instead of accepting it.`);
      }
    }
    for (const a of input.answers) {
      await tx.update(planningItem).set({ answer: a.answer, status: a.status }).where(eq(planningItem.id, a.itemId));
    }
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "answers", newValue: `${input.answers.length} answered` });
    return { answered: input.answers.length };
  });
}

/**
 * Completes a system's planning with the user's verbatim confirmation. Editor or higher.
 *
 * @throws ConflictError listing every gap from {@link planningGaps}
 */
export async function completePlanning(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof completePlanningInput>,
): Promise<{ completedAt: Date }> {
  const input = completePlanningInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    if (parent.planningCompletedAt) return { completedAt: parent.planningCompletedAt };
    const gaps = await planningGaps(tx, parent.id);
    if (gaps.length > 0) throw new ConflictError(`Planning of system ${parent.slug} is not complete: ${gaps.join(" ")}`);
    const completedAt = new Date();
    await tx.update(system).set({ planningCompletedAt: completedAt, planningConfirmation: input.userConfirmation }).where(eq(system.id, parent.id));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "completed", newValue: input.userConfirmation });
    return { completedAt };
  });
}

/** Reopens a system's planning and returns it to its board's planning column. Editor or higher. */
export async function reopenPlanning(db: Db, actor: Actor, projectSlug: string, systemSlug: string): Promise<void> {
  await db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    if (!parent.planningCompletedAt) throw new ConflictError(`Planning of system ${parent.slug} is not complete; there is nothing to reopen.`);
    // Share-lock the board so a concurrent column edit cannot remove the planning column used below.
    await tx.select({ id: board.id }).from(board).where(eq(board.id, parent.boardId)).for("share");
    const boards = await loadBoards(tx, parent.projectId);
    const currentBoard = boards.find((b) => b.id === parent.boardId);
    const planningColumn = currentBoard?.columns.find((c) => c.category === "planning");
    if (!currentBoard || !planningColumn) throw new ConflictError(`The board of system ${parent.slug} has no planning column.`);
    await tx
      .update(system)
      .set({ planningCompletedAt: null, planningConfirmation: null, columnId: planningColumn.id })
      .where(eq(system.id, parent.id));
    // The full interview is open again, so single-area reopens end without a confirmation.
    await tx
      .update(planningAreaReopen)
      .set({ closedAt: new Date() })
      .where(and(eq(planningAreaReopen.systemId, parent.id), isNull(planningAreaReopen.closedAt)));
    if (planningColumn.id !== parent.columnId) {
      const fromColumn = currentBoard.columns.find((c) => c.id === parent.columnId);
      await logChange(tx, actor, {
        projectId: parent.projectId,
        systemId: parent.id,
        entity: "system",
        entityId: parent.id,
        field: "column",
        oldValue: `${currentBoard.name} / ${fromColumn?.name}`,
        newValue: `${currentBoard.name} / ${planningColumn.name}`,
      });
    }
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "reopened" });
  });
}

/**
 * Reopens one planning area of a system whose planning is complete, with the reason.
 * Planning stays complete and the system stays in its column, so tasks go on; only that
 * area then accepts new rounds and answers, and the system cannot enter a done column
 * until {@link completePlanningArea} closes it. Reopening an area that is already
 * reopened returns the existing reopen. Editor or higher.
 *
 * @throws ConflictError if planning is not complete
 */
export async function reopenPlanningArea(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof reopenAreaInput>,
): Promise<{ area: PlanningArea; reopenedAt: Date }> {
  const input = reopenAreaInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    if (!parent.planningCompletedAt) throw new ConflictError(`Planning of ${parent.slug} is not complete; keep answering in the open interview.`);
    const existing = (await openAreaReopens(tx, parent.id)).find((r) => r.area === input.area);
    if (existing) return { area: input.area, reopenedAt: existing.reopenedAt };
    const [row] = await tx
      .insert(planningAreaReopen)
      .values({ id: newId(), systemId: parent.id, area: input.area, reason: input.reason, reopenedByUserId: actor.userId, agent: actor.agent ?? null })
      .returning({ reopenedAt: planningAreaReopen.reopenedAt });
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "area-reopened", oldValue: input.reason, newValue: input.area });
    return { area: input.area, reopenedAt: row.reopenedAt };
  });
}

/**
 * Closes a reopened planning area with the user's confirmation. The area needs at least
 * one question asked since it was reopened, and none of its questions may be open. Editor or higher.
 *
 * @throws ConflictError if the area is not reopened, has no new question, or has an open item
 */
export async function completePlanningArea(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof completeAreaInput>,
): Promise<{ area: PlanningArea; closedAt: Date }> {
  const input = completeAreaInput.parse(raw);
  return db.transaction(async (tx) => {
    const parent = await lockForPlanning(tx, actor, projectSlug, systemSlug);
    const [reopen] = await tx
      .select()
      .from(planningAreaReopen)
      .where(and(eq(planningAreaReopen.systemId, parent.id), eq(planningAreaReopen.area, input.area), isNull(planningAreaReopen.closedAt)));
    if (!reopen) throw new ConflictError(`Area ${input.area} of ${parent.slug} is not reopened.`);
    const items = await tx
      .select({ id: planningItem.id, question: planningItem.question, status: planningItem.status, createdAt: planningRound.createdAt })
      .from(planningItem)
      .innerJoin(planningRound, eq(planningRound.id, planningItem.roundId))
      .where(and(eq(planningRound.systemId, parent.id), eq(planningItem.area, input.area)))
      .orderBy(asc(planningRound.number), asc(planningItem.sortOrder));
    if (!items.some((i) => i.createdAt >= reopen.reopenedAt)) throw new ConflictError(`No question was asked since area ${input.area} was reopened.`);
    const open = items.find((i) => i.status === "open");
    if (open) throw new ConflictError(`Item ${open.id} is still open: "${short(open.question)}".`);
    const closedAt = new Date();
    await tx.update(planningAreaReopen).set({ closedAt, confirmation: input.userConfirmation }).where(eq(planningAreaReopen.id, reopen.id));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "area-completed", oldValue: input.userConfirmation, newValue: input.area });
    return { area: input.area, closedAt };
  });
}
