import { and, asc, count, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { eventQuestion, eventQuestionRound, eventRequest, user, type EventQuestionRow } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { answerValueSchema, askRoundInput, type QuestionConfig, type QuestionType } from "@/lib/event-questions";
import { newId } from "@/lib/id";
import { actorValues } from "@/lib/notification-text";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { ConflictError, InvalidError } from "./errors";
import { requestAccess } from "./request-access";
import { developerIds, notifyRequest } from "./request-notify";
import { logRequest } from "./requests";

/** The statuses in which the team may still ask questions. */
const ASKABLE = ["submitted", "accepted", "event_week"] as const;

/** Input of {@link answerQuestions}: per question either a `value` or `notSure: true`. */
export const answerQuestionsInput = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1).max(64), value: z.unknown().optional(), notSure: z.boolean().optional() }))
    .min(1)
    .max(50),
});

/** Describes the first problem of a failed parse for an {@link InvalidError}. */
function describeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message;
}

/** Locks the request row for the rest of the transaction so concurrent writes queue up. */
async function lock(tx: Executor, requestId: string): Promise<void> {
  await tx.select({ id: eventRequest.id }).from(eventRequest).where(eq(eventRequest.id, requestId)).for("update").limit(1);
}

/**
 * Asks a round of one to five typed questions. A second round may be asked while another is unanswered.
 * The requester gets one `request.question` notice per round.
 *
 * @throws InvalidError when the questions are invalid or more than five
 * @throws ForbiddenError unless the actor is an event developer, admin or editor of the linked project
 * @throws ConflictError unless the request is submitted, accepted or in event week
 */
export async function askRound(
  db: Db,
  actor: Actor,
  requestId: string,
  raw: z.input<typeof askRoundInput>,
): Promise<{ roundId: string; number: number; questionIds: string[] }> {
  const parsed = askRoundInput.safeParse(raw);
  if (!parsed.success) throw new InvalidError(describeIssue(parsed.error));
  return db.transaction(async (tx) => {
    await lock(tx, requestId);
    const { request } = await requestAccess(tx, actor, requestId, "develop");
    if (!(ASKABLE as readonly string[]).includes(request.status)) throw new ConflictError(`Questions cannot be asked on a ${request.status} request.`);
    const [{ last }] = await tx.select({ last: max(eventQuestionRound.number) }).from(eventQuestionRound).where(eq(eventQuestionRound.requestId, requestId));
    const number = (last ?? 0) + 1;
    const roundId = newId();
    await tx.insert(eventQuestionRound).values({ id: roundId, requestId, number, askedBy: actor.userId, agent: actor.agent ?? null });
    const questionIds: string[] = [];
    for (const [position, q] of parsed.data.questions.entries()) {
      const id = newId();
      questionIds.push(id);
      const config: QuestionConfig = {
        ...(q.options ? { options: q.options } : {}),
        ...(q.other ? { other: true } : {}),
        ...(q.min !== undefined ? { min: q.min } : {}),
        ...(q.max !== undefined ? { max: q.max } : {}),
        ...(q.unit ? { unit: q.unit } : {}),
      };
      await tx.insert(eventQuestion).values({
        id,
        roundId,
        requestId,
        position,
        type: q.type,
        text: q.text,
        why: q.why || null,
        required: q.required,
        config,
        suggested: q.suggested ?? null,
      });
    }
    await logRequest(tx, actor, { requestId, field: "questions", newValue: `round ${number} asked` });
    if (request.requesterId) {
      await notifyRequest(tx, {
        requestId,
        kind: "request.question",
        userIds: [request.requesterId],
        title: { key: "requestQuestion", values: { title: request.title } },
        body: { key: "requestQuestionBody", values: { count: questionIds.length } },
        sourceKey: `req:${requestId}:round:${number}`,
        tab: "questions",
        actor,
      });
    }
    return { roundId, number, questionIds };
  });
}

/**
 * Answers questions of a request: per answer a typed `value` or `notSure: true`, never both. Re-answering overwrites.
 * When this completes a round (every question has a value or is "not sure"), developers get one `request.answered` notice naming how many are "not sure".
 *
 * @returns how many answers were stored and the numbers of the rounds that this call completed
 * @throws InvalidError for an unknown question, a repeated one, a value of the wrong type, or both or neither of `value` and `notSure`
 * @throws ForbiddenError unless the actor is the requester of an open request or an event manager
 * @throws NotFoundError when the actor may not see the request
 */
export async function answerQuestions(
  db: Db,
  actor: Actor,
  requestId: string,
  raw: z.input<typeof answerQuestionsInput>,
): Promise<{ answered: number; completedRounds: number[] }> {
  const parsed = answerQuestionsInput.safeParse(raw);
  if (!parsed.success) throw new InvalidError(describeIssue(parsed.error));
  return db.transaction(async (tx) => {
    await lock(tx, requestId);
    const { request } = await requestAccess(tx, actor, requestId, "edit");
    const rows = await tx
      .select({ question: eventQuestion, round: eventQuestionRound.number })
      .from(eventQuestion)
      .innerJoin(eventQuestionRound, eq(eventQuestionRound.id, eventQuestion.roundId))
      .where(eq(eventQuestion.requestId, requestId));
    const byId = new Map(rows.map((r) => [r.question.id, r]));
    const open = new Map<number, number>();
    for (const r of rows) if (r.question.answeredAt === null) open.set(r.round, (open.get(r.round) ?? 0) + 1);
    const seen = new Set<string>();
    const now = new Date();
    const changes: { id: string; round: number; patch: Partial<EventQuestionRow> }[] = [];
    for (const answer of parsed.data.answers) {
      const found = byId.get(answer.questionId);
      if (!found) throw new InvalidError(`Unknown question ${answer.questionId} on this request.`);
      const { question } = found;
      const label = `question "${question.text}" (${question.id})`;
      if (seen.has(question.id)) throw new InvalidError(`The ${label} is answered twice.`);
      seen.add(question.id);
      const hasValue = answer.value !== undefined;
      if (hasValue && answer.notSure) throw new InvalidError(`The ${label} needs either a value or notSure, not both.`);
      if (!hasValue && !answer.notSure) throw new InvalidError(`The ${label} needs a value or notSure: true.`);
      if (hasValue) {
        const result = answerValueSchema({ type: question.type, ...question.config }).safeParse(answer.value);
        if (!result.success) throw new InvalidError(`The answer to ${label} is invalid: ${result.error.issues[0]?.message ?? "wrong type"}`);
        changes.push({ id: question.id, round: found.round, patch: { answer: result.data, notSure: false } });
      } else {
        changes.push({ id: question.id, round: found.round, patch: { answer: null, notSure: true } });
      }
    }
    const state = new Map(rows.map((r) => [r.question.id, { round: r.round, answered: r.question.answeredAt !== null, notSure: r.question.notSure }]));
    for (const change of changes) {
      await tx
        .update(eventQuestion)
        .set({ ...change.patch, answeredBy: actor.userId, answeredAt: now })
        .where(eq(eventQuestion.id, change.id));
      state.set(change.id, { round: change.round, answered: true, notSure: change.patch.notSure === true });
      const found = byId.get(change.id)!;
      await logRequest(tx, actor, {
        requestId,
        field: "answer",
        newValue: `round ${found.round}, question ${found.question.position + 1}: ${change.patch.notSure ? "not sure" : "answered"}`,
      });
    }
    const completedRounds = [...new Set(changes.map((c) => c.round))].filter((round) => {
      if ((open.get(round) ?? 0) === 0) return false;
      return [...state.values()].filter((s) => s.round === round).every((s) => s.answered);
    });
    for (const round of completedRounds) {
      const questions = [...state.values()].filter((s) => s.round === round);
      const notSure = questions.filter((s) => s.notSure).length;
      await notifyRequest(tx, {
        requestId,
        kind: "request.answered",
        userIds: await developerIds(tx),
        title: { key: "requestAnswered", values: { ...actorValues(actor.name, actor.agent), title: request.title } },
        body: notSure === 0 ? { key: "requestAnsweredBody" } : { key: "requestAnsweredNotSure", values: { notSure, total: questions.length } },
        sourceKey: `req:${requestId}:answered:${round}`,
        tab: "questions",
        actor,
      });
    }
    return { answered: changes.length, completedRounds };
  });
}

/** A question with its config fields flattened, and its answer once given. */
export interface QuestionView extends QuestionConfig {
  id: string;
  position: number;
  type: QuestionType;
  text: string;
  why: string | null;
  required: boolean;
  suggested: unknown;
  /** The typed value (see `answerValueSchema`); null while open and when the answer is "not sure". */
  answer: unknown;
  notSure: boolean;
  answeredByName: string | null;
  answeredAt: Date | null;
}

/** A round with its questions. */
export interface RoundView extends AuthorFields {
  id: string;
  number: number;
  createdAt: Date;
  questions: QuestionView[];
}

/**
 * Returns the rounds of a request, oldest first, with their questions, answers (typed as stored), "not sure" flags, and who answered when.
 *
 * @throws NotFoundError when the actor may not see the request
 */
export async function listRounds(db: Db, actor: Actor, requestId: string): Promise<RoundView[]> {
  await requestAccess(db, actor, requestId, "view");
  const rounds = await db
    .select({ id: eventQuestionRound.id, number: eventQuestionRound.number, createdAt: eventQuestionRound.createdAt, agent: eventQuestionRound.agent, askedByName: user.name })
    .from(eventQuestionRound)
    .leftJoin(user, eq(user.id, eventQuestionRound.askedBy))
    .where(eq(eventQuestionRound.requestId, requestId))
    .orderBy(asc(eventQuestionRound.number));
  if (rounds.length === 0) return [];
  const questions = await db
    .select({ question: eventQuestion, answeredByName: user.name })
    .from(eventQuestion)
    .leftJoin(user, eq(user.id, eventQuestion.answeredBy))
    .where(and(eq(eventQuestion.requestId, requestId), inArray(eventQuestion.roundId, rounds.map((r) => r.id))))
    .orderBy(asc(eventQuestion.position));
  return rounds.map(({ askedByName, agent, ...round }) => ({
    ...round,
    ...authorFields(askedByName, agent),
    questions: questions
      .filter((q) => q.question.roundId === round.id)
      .map(({ question: q, answeredByName }) => ({
        id: q.id,
        position: q.position,
        type: q.type,
        text: q.text,
        why: q.why,
        required: q.required,
        ...q.config,
        suggested: q.suggested,
        answer: q.answer,
        notSure: q.notSure,
        answeredByName: q.answeredAt ? answeredByName?.trim() || "unknown" : null,
        answeredAt: q.answeredAt,
      })),
  }));
}

/** Returns how many questions of the request are unanswered across all rounds ("not sure" counts as answered). */
export async function openQuestionCount(db: Executor, requestId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(eventQuestion)
    .where(and(eq(eventQuestion.requestId, requestId), isNull(eventQuestion.answeredAt)));
  return row.n;
}
