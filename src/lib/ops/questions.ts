import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { QUESTION_PRIORITIES, question, system, user, type QuestionPriority } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem } from "./lookup";
import { notifyMentions, resolveMentionsIn } from "./mentions";
import { actorValues } from "@/lib/notification-text";

/** Longest question text or answer. */
const TEXT_MAX = 5000;

/** Input of {@link addQuestion}. */
export const addQuestionInput = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().max(TEXT_MAX).default(""),
  system: slugSchema.optional(),
  priority: z.enum(QUESTION_PRIORITIES).default("normal"),
});

/** Input of {@link answerQuestion}. */
export const answerQuestionInput = z.object({
  id: z.string().min(1),
  answer: z.string().trim().min(1).max(TEXT_MAX),
  resolved: z.boolean().default(true),
});

/** Filters of {@link listQuestions}. */
export const questionFilter = z.object({ system: z.string().optional(), resolved: z.boolean().optional() });

/** An open question as listed, with who asked it and who last answered it. */
export interface QuestionItem extends AuthorFields {
  id: string;
  title: string;
  text: string;
  answer: string | null;
  resolved: boolean;
  priority: QuestionPriority;
  systemSlug: string | null;
  systemTitle: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  /** Who last answered, labelled like `author`; `null` while unanswered. */
  answeredBy: string | null;
  /** The person who last answered (`unknown` when their account is gone); `null` while unanswered. */
  answeredByName: string | null;
  /** The agent that answered for that person, or `null`. */
  answeredAgent: string | null;
  /** When the question was last answered; `null` while unanswered. */
  answeredAt: Date | null;
}

/** The user who answered a question, joined next to the asking user. */
const answeringUser = alias(user, "answerer");

/** Loads a question of the project or throws `NotFoundError`; `lock` holds the row until the transaction ends. */
async function findQuestion(tx: Executor, projectId: string, id: string, lock = false) {
  const query = tx
    .select()
    .from(question)
    .where(and(eq(question.id, id), eq(question.projectId, projectId)))
    .limit(1);
  const [row] = await (lock ? query.for("no key update") : query);
  if (!row) throw new NotFoundError(`Unknown question ${id}.`);
  return row;
}

/** Adds an unresolved question, optionally tied to a system that is not archived. Editor or higher. */
export async function addQuestion(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof addQuestionInput>): Promise<{ id: string }> {
  const input = addQuestionInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    // Locking takes the write path, which refuses an archived system.
    const parent = input.system ? await findSystem(tx, project.id, input.system, true) : null;
    const id = newId();
    const text = await resolveMentionsIn(tx, project.id, input.text, TEXT_MAX);
    await tx.insert(question).values({
      id,
      projectId: project.id,
      systemId: parent?.id ?? null,
      title: input.title,
      text,
      priority: input.priority,
      authorUserId: actor.userId,
      agent: actor.agent ?? null,
    });
    await logChange(tx, actor, { projectId: project.id, systemId: parent?.id, entity: "question", entityId: id, field: "created", newValue: input.title });
    await notifyMentions(tx, actor, {
      projectId: project.id,
      before: null,
      after: text,
      title: { key: "mentionQuestion", values: { ...actorValues(actor.name, actor.agent) } },
      href: `/p/${project.slug}/questions#q-${id}`,
      source: `question:${id}:text`,
    });
    return { id };
  });
}

/**
 * Records the answer to a question, who gave it (with their agent) and when,
 * and by default resolves it. Editor or higher.
 */
export async function answerQuestion(db: Db, actor: Actor, projectSlug: string, raw: z.input<typeof answerQuestionInput>): Promise<void> {
  const input = answerQuestionInput.parse(raw);
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    await answerQuestionInTx(tx, actor, project, input);
  });
}

/** {@link answerQuestion} inside the caller's transaction, for a project the caller has checked editor access to. */
export async function answerQuestionInTx(
  tx: Executor,
  actor: Actor,
  project: { id: string; slug: string },
  input: z.output<typeof answerQuestionInput>,
): Promise<void> {
  const current = await findQuestion(tx, project.id, input.id, true);
  const answer = await resolveMentionsIn(tx, project.id, input.answer, TEXT_MAX);
  const now = new Date();
  await tx
    .update(question)
    .set({
      answer,
      resolved: input.resolved,
      resolvedAt: input.resolved ? (current.resolvedAt ?? now) : null,
      answeredByUserId: actor.userId,
      answeredAgent: actor.agent ?? null,
      answeredAt: now,
    })
    .where(eq(question.id, current.id));
  await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: current.id, field: "answer", oldValue: current.answer, newValue: answer });
  if (current.resolved !== input.resolved) {
    await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: current.id, field: "resolved", oldValue: String(current.resolved), newValue: String(input.resolved) });
  }
  await notifyMentions(tx, actor, {
    projectId: project.id,
    before: current.answer,
    after: answer,
    title: { key: "mentionAnswer", values: { ...actorValues(actor.name, actor.agent) } },
    href: `/p/${project.slug}/questions#q-${current.id}`,
    source: `question:${current.id}:answer`,
  });
}

/** Marks a question resolved or unresolved. Editor or higher. */
export async function setQuestionResolved(db: Db, actor: Actor, projectSlug: string, id: string, resolved: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findQuestion(tx, project.id, id, true);
    if (current.resolved === resolved) return;
    await tx.update(question).set({ resolved, resolvedAt: resolved ? new Date() : null }).where(eq(question.id, id));
    await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: id, field: "resolved", oldValue: String(current.resolved), newValue: String(resolved) });
  });
}

/** Sets a question's priority. Editor or higher. */
export async function setQuestionPriority(db: Db, actor: Actor, projectSlug: string, id: string, priority: QuestionPriority): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const current = await findQuestion(tx, project.id, id, true);
    if (current.priority === priority) return;
    await tx.update(question).set({ priority }).where(eq(question.id, id));
    await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: id, field: "priority", oldValue: current.priority, newValue: priority });
  });
}

/** Lists questions of the project, unresolved first (blocking, normal, nice), then newest first. */
export async function listQuestions(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof questionFilter> = {},
): Promise<QuestionItem[]> {
  const filter = questionFilter.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const systemId = filter.system ? (await findSystem(db, project.id, filter.system)).id : undefined;
  return questionsOf(db, project.id, { systemId, resolved: filter.resolved });
}

/** {@link listQuestions} for a project and system the caller already resolved; performs no access check. */
export async function questionsOf(db: Executor, projectId: string, filter: { systemId?: string; resolved?: boolean; ids?: string[] }): Promise<QuestionItem[]> {
  const conditions: SQL[] = [eq(question.projectId, projectId)];
  if (filter.ids) conditions.push(inArray(question.id, filter.ids));
  if (filter.systemId) conditions.push(eq(question.systemId, filter.systemId));
  if (filter.resolved !== undefined) conditions.push(eq(question.resolved, filter.resolved));
  const rows = await db
    .select({
      id: question.id,
      title: question.title,
      text: question.text,
      answer: question.answer,
      resolved: question.resolved,
      priority: question.priority,
      systemSlug: system.slug,
      systemTitle: system.title,
      authorName: user.name,
      agent: question.agent,
      createdAt: question.createdAt,
      resolvedAt: question.resolvedAt,
      answererName: answeringUser.name,
      answeredAgent: question.answeredAgent,
      answeredAt: question.answeredAt,
    })
    .from(question)
    .leftJoin(system, eq(system.id, question.systemId))
    .leftJoin(user, eq(user.id, question.authorUserId))
    .leftJoin(answeringUser, eq(answeringUser.id, question.answeredByUserId))
    .where(and(...conditions))
    .orderBy(
      asc(question.resolved),
      // Unresolved ones rank by priority; resolved ones keep newest first.
      asc(sql`case when ${question.resolved} then 0 when ${question.priority} = 'blocking' then 1 when ${question.priority} = 'normal' then 2 else 3 end`),
      desc(question.createdAt),
      desc(question.id),
    );
  return rows.map(({ authorName, agent, answererName, ...r }) => {
    const answerer = r.answeredAt ? authorFields(answererName, r.answeredAgent) : null;
    return { ...r, ...authorFields(authorName, agent), answeredBy: answerer?.author ?? null, answeredByName: answerer?.authorName ?? null };
  });
}
