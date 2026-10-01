import { eq } from "drizzle-orm";
import type { z } from "zod";
import { project, system, user } from "@/db/schema";
import type { Db } from "@/db/types";
import type { DiffHunk } from "@/lib/diff";
import type { askRoundInput, QuestionType } from "@/lib/event-questions";
import type { Actor } from "./actor";
import { InvalidError, NotFoundError } from "./errors";
import { requestAccess } from "./request-access";
import { getSpecBasis, type SpecBasis } from "./request-link";
import { askRound, listRounds, openQuestionCount } from "./request-questions";
import { compareBriefs, getBrief } from "./requests";

/** Longest answer text `get_request` returns whole. */
const ANSWER_CHARS = 500;

/** What an agent reads of a request. */
export interface RequestForAgent {
  id: string;
  title: string;
  status: string;
  startsAt: Date | null;
  durationMinutes: number | null;
  where: string;
  eventDocsUrl: string | null;
  requester: { name: string };
  project: { slug: string } | null;
  system: { slug: string } | null;
  brief: { version: number; body: string } | { version: number; since: number; diff: { hunks: DiffHunk[]; added: number; removed: number } };
  specBasis: SpecBasis | null;
  rounds: { number: number; questions: { id: string; type: QuestionType; text: string; answer: unknown; notSure: boolean; answered: boolean }[] }[];
  openQuestions: number;
  notSure: { questionId: string; text: string }[];
  fallback: { key: string; title: string; filled: boolean }[];
  progress: { done: number; total: number } | null;
  /** True when a long answer was cut. */
  truncated?: true;
}

/**
 * Checks that the actor acts as a developer of a submitted request; the agent runs as its developer user, so a requester's own agent cannot get through.
 *
 * @throws NotFoundError when the request is unknown, invisible or still a draft
 * @throws ForbiddenError when the actor may view but not develop the request
 */
async function agentAccess(db: Db, actor: Actor, requestId: string) {
  const access = await requestAccess(db, actor, requestId, "develop");
  if (access.request.status === "draft") throw new NotFoundError(`Unknown request ${requestId}.`);
  return access;
}

/** Asks a round of typed questions on behalf of the developer; see {@link askRound}. */
export async function askRequester(db: Db, actor: Actor, requestId: string, input: z.input<typeof askRoundInput>) {
  await agentAccess(db, actor, requestId);
  return askRound(db, actor, requestId, input);
}

/** Cuts every string longer than {@link ANSWER_CHARS} inside an answer and counts the cuts. */
function cutAnswer(value: unknown, cuts: { n: number }): unknown {
  if (typeof value === "string" && value.length > ANSWER_CHARS) {
    cuts.n += 1;
    return `${value.slice(0, ANSWER_CHARS)}… (${value.length - ANSWER_CHARS} more characters)`;
  }
  if (Array.isArray(value)) return value.map((v) => cutAnswer(v, cuts));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cutAnswer(v, cuts)]));
  return value;
}

/**
 * Returns a request for an agent: brief (or its diff since `sinceBrief`), event data, typed answers and open questions.
 * Fallback and progress stay empty until their tasks land.
 *
 * @throws InvalidError unless `sinceBrief` is lower than the current brief version
 * @throws NotFoundError when the request is unknown, invisible or a draft
 * @throws ForbiddenError when the actor may not develop the request
 */
export async function requestForAgent(db: Db, actor: Actor, requestId: string, sinceBrief?: number): Promise<RequestForAgent> {
  const { request } = await agentAccess(db, actor, requestId);
  if (sinceBrief !== undefined && sinceBrief >= request.briefVersion) throw new InvalidError("sinceBrief must be lower than the current brief version.");
  const brief: RequestForAgent["brief"] =
    sinceBrief === undefined
      ? { version: request.briefVersion, body: (await getBrief(db, actor, requestId)).body }
      : { version: request.briefVersion, since: sinceBrief, diff: await compareBriefs(db, actor, requestId, sinceBrief, request.briefVersion) };
  const [[requester], [proj], [sys], rounds, openQuestions, specBasis] = await Promise.all([
    db.select({ name: user.name }).from(user).where(eq(user.id, request.requesterId ?? "")).limit(1),
    request.projectId ? db.select({ slug: project.slug }).from(project).where(eq(project.id, request.projectId)).limit(1) : [],
    request.systemId ? db.select({ slug: system.slug }).from(system).where(eq(system.id, request.systemId)).limit(1) : [],
    listRounds(db, actor, requestId),
    openQuestionCount(db, requestId),
    getSpecBasis(db, requestId),
  ]);
  const cuts = { n: 0 };
  const views = rounds.map((r) => ({
    number: r.number,
    questions: r.questions.map((q) => ({ id: q.id, type: q.type, text: q.text, answer: cutAnswer(q.answer, cuts), notSure: q.notSure, answered: q.answeredAt !== null })),
  }));
  return {
    id: request.id,
    title: request.title,
    status: request.status,
    startsAt: request.startsAt,
    durationMinutes: request.durationMinutes,
    where: request.where,
    eventDocsUrl: request.eventDocsUrl,
    requester: { name: requester?.name?.trim() || "unknown" },
    project: proj ?? null,
    system: sys ?? null,
    brief,
    specBasis,
    rounds: views,
    openQuestions,
    notSure: views.flatMap((r) => r.questions.filter((q) => q.notSure).map((q) => ({ questionId: q.id, text: q.text }))),
    fallback: [],
    progress: null,
    ...(cuts.n > 0 ? { truncated: true as const } : {}),
  };
}
