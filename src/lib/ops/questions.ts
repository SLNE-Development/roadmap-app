import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { question, system, user } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess, slugSchema } from "./access";
import { authorFields, type Actor, type AuthorFields } from "./actor";
import { NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem } from "./lookup";

/** Input of {@link addQuestion}. */
export const addQuestionInput = z.object({
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().max(5000).default(""),
  system: slugSchema.optional(),
});

/** Input of {@link answerQuestion}. */
export const answerQuestionInput = z.object({
  id: z.string().min(1),
  answer: z.string().trim().min(1).max(5000),
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
    await tx.insert(question).values({
      id,
      projectId: project.id,
      systemId: parent?.id ?? null,
      title: input.title,
      text: input.text,
      authorUserId: actor.userId,
      agent: actor.agent ?? null,
    });
    await logChange(tx, actor, { projectId: project.id, systemId: parent?.id, entity: "question", entityId: id, field: "created", newValue: input.title });
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
    const current = await findQuestion(tx, project.id, input.id, true);
    const now = new Date();
    await tx
      .update(question)
      .set({
        answer: input.answer,
        resolved: input.resolved,
        resolvedAt: input.resolved ? (current.resolvedAt ?? now) : null,
        answeredByUserId: actor.userId,
        answeredAgent: actor.agent ?? null,
        answeredAt: now,
      })
      .where(eq(question.id, current.id));
    await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: current.id, field: "answer", oldValue: current.answer, newValue: input.answer });
    if (current.resolved !== input.resolved) {
      await logChange(tx, actor, { projectId: project.id, systemId: current.systemId, entity: "question", entityId: current.id, field: "resolved", oldValue: String(current.resolved), newValue: String(input.resolved) });
    }
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

/** Lists questions of the project, unresolved first, then newest first. */
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
export async function questionsOf(db: Executor, projectId: string, filter: { systemId?: string; resolved?: boolean }): Promise<QuestionItem[]> {
  const conditions: SQL[] = [eq(question.projectId, projectId)];
  if (filter.systemId) conditions.push(eq(question.systemId, filter.systemId));
  if (filter.resolved !== undefined) conditions.push(eq(question.resolved, filter.resolved));
  const rows = await db
    .select({
      id: question.id,
      title: question.title,
      text: question.text,
      answer: question.answer,
      resolved: question.resolved,
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
    .orderBy(asc(question.resolved), desc(question.createdAt), desc(question.id));
  return rows.map(({ authorName, agent, answererName, ...r }) => {
    const answerer = r.answeredAt ? authorFields(answererName, r.answeredAgent) : null;
    return { ...r, ...authorFields(authorName, agent), answeredBy: answerer?.author ?? null, answeredByName: answerer?.authorName ?? null };
  });
}
