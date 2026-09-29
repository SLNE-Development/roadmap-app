import { and, asc, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import {
  PLANNING_AREAS,
  planningItem,
  planningRound,
  system,
  systemDocument,
  user,
  type PlanningArea,
  type PlanningItemStatus,
} from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import { authorLabel, type Actor } from "./actor";
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

/** A planning question as shown. */
export interface PlanningItemView {
  id: string;
  area: PlanningArea;
  question: string;
  answer: string | null;
  isRisk: boolean;
  status: PlanningItemStatus;
}

/** A planning round with its questions. */
export interface PlanningRoundView {
  number: number;
  createdAt: Date;
  author: string;
  items: PlanningItemView[];
}

/** The whole planning interview of a system and what still blocks its completion. */
export interface PlanningView {
  completedAt: Date | null;
  confirmation: string | null;
  rounds: PlanningRoundView[];
  gaps: string[];
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
    author: authorLabel(r.authorName, r.agent),
    items: items
      .filter((i) => i.roundId === r.id)
      .map((i) => ({ id: i.id, area: i.area, question: i.question, answer: i.answer, isRisk: i.isRisk, status: i.status })),
  }));
}

/**
 * Returns what still prevents completing a system's planning, in this order:
 * areas without an answered or accepted item, open items, and a missing spec.
 */
export async function planningGaps(db: Executor, systemId: string): Promise<string[]> {
  const items = (await loadRounds(db, systemId)).flatMap((r) => r.items);
  const gaps: string[] = [];
  for (const area of PLANNING_AREAS) {
    if (!items.some((i) => i.area === area && i.status !== "open")) gaps.push(`Area ${area} has no answered item.`);
  }
  for (const item of items.filter((i) => i.status === "open")) gaps.push(`Item ${item.id} is still open: "${short(item.question)}".`);
  const spec = await db
    .select({ id: systemDocument.id })
    .from(systemDocument)
    .where(and(eq(systemDocument.systemId, systemId), eq(systemDocument.kind, "spec")))
    .limit(1);
  if (spec.length === 0) gaps.push("No spec has been written; call write_spec.");
  return gaps;
}

/** Throws when the system's planning is already complete. */
function assertOpen(parent: SystemRow): void {
  if (parent.planningCompletedAt) throw new ConflictError(`Planning of system ${parent.slug} is complete; call reopen_planning to change it.`);
}

/** Locks and returns a system for a planning write, checking the editor role. */
async function lockForPlanning(tx: Tx, actor: Actor, projectSlug: string, systemSlug: string): Promise<SystemRow> {
  const { project } = await projectAccess(tx, actor, projectSlug, "editor");
  return findSystem(tx, project.id, systemSlug, true);
}

/** Returns a system's planning interview, completion state and remaining gaps. */
export async function getPlanning(db: Executor, actor: Actor, projectSlug: string, systemSlug: string): Promise<PlanningView> {
  const { system: parent } = await systemAccess(db, actor, projectSlug, systemSlug, "viewer");
  return {
    completedAt: parent.planningCompletedAt,
    confirmation: parent.planningConfirmation,
    rounds: await loadRounds(db, parent.id),
    gaps: parent.planningCompletedAt ? [] : await planningGaps(db, parent.id),
  };
}

/**
 * Records the next round of planning questions before they are asked. Editor or higher.
 *
 * @throws ConflictError if planning is complete
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
    assertOpen(parent);
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
 * @throws ConflictError if planning is complete
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
    assertOpen(parent);
    const ids = input.answers.map((a) => a.itemId);
    const found = await tx
      .select({ id: planningItem.id, isRisk: planningItem.isRisk })
      .from(planningItem)
      .innerJoin(planningRound, eq(planningRound.id, planningItem.roundId))
      .where(and(eq(planningRound.systemId, parent.id), inArray(planningItem.id, ids)));
    const byId = new Map(found.map((f) => [f.id, f]));
    for (const a of input.answers) {
      const item = byId.get(a.itemId);
      if (!item) throw new NotFoundError(`Unknown planning item ${a.itemId}.`);
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
    const boards = await loadBoards(tx, parent.projectId);
    const planningColumn = boards.find((b) => b.id === parent.boardId)?.columns.find((c) => c.category === "planning");
    if (!planningColumn) throw new ConflictError(`The board of system ${parent.slug} has no planning column.`);
    await tx
      .update(system)
      .set({ planningCompletedAt: null, planningConfirmation: null, columnId: planningColumn.id })
      .where(eq(system.id, parent.id));
    await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "planning", entityId: parent.id, field: "reopened" });
  });
}
