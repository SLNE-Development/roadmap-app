import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { glossaryTerm } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { GlossaryTerm } from "@/lib/glossary-match";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { NotFoundError } from "./errors";
import { logChange } from "./log";
import { lockProject } from "./lookup";

export type { GlossaryTerm };

/** Input of {@link setGlossaryTerm}; without `aliases` a new term has none and an existing one keeps its own. */
export const setGlossaryTermInput = z.object({
  term: z.string().trim().min(1).max(60),
  definition: z.string().trim().min(1).max(1000),
  aliases: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
});

/** Lists the project's glossary, ordered by term ignoring case. Viewer or higher. */
export async function listGlossary(db: Executor, actor: Actor, projectSlug: string): Promise<GlossaryTerm[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  return db
    .select({ id: glossaryTerm.id, term: glossaryTerm.term, definition: glossaryTerm.definition, aliases: glossaryTerm.aliases })
    .from(glossaryTerm)
    .where(eq(glossaryTerm.projectId, project.id))
    .orderBy(asc(sql`lower(${glossaryTerm.term})`), asc(glossaryTerm.id));
}

/**
 * Lists the term and definition of a project's glossary, ordered by term ignoring case.
 * Does **not** check access: for callers that already did, such as the project brief resource.
 */
export async function glossaryBrief(db: Executor, projectId: string): Promise<{ term: string; definition: string }[]> {
  return db
    .select({ term: glossaryTerm.term, definition: glossaryTerm.definition })
    .from(glossaryTerm)
    .where(eq(glossaryTerm.projectId, projectId))
    .orderBy(asc(sql`lower(${glossaryTerm.term})`), asc(glossaryTerm.id));
}

/** Finds a term of the project ignoring case. */
async function findTerm(tx: Executor, projectId: string, term: string) {
  const [row] = await tx
    .select()
    .from(glossaryTerm)
    .where(and(eq(glossaryTerm.projectId, projectId), sql`lower(${glossaryTerm.term}) = lower(${term})`))
    .limit(1);
  return row;
}

/**
 * Adds a term or changes the definition and aliases of the one with the same term, ignoring case,
 * and logs the creation or the definition change. Editor or higher.
 */
export async function setGlossaryTerm(
  db: Db,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof setGlossaryTermInput>,
): Promise<{ id: string; created: boolean }> {
  const input = setGlossaryTermInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    await lockProject(tx, project.id);
    const existing = await findTerm(tx, project.id, input.term);
    const entry = { projectId: project.id, entity: "glossary" };
    const stamp = { updatedByUserId: actor.userId, agent: actor.agent ?? null, updatedAt: new Date() };
    if (!existing) {
      const id = newId();
      await tx.insert(glossaryTerm).values({ id, projectId: project.id, ...input, aliases: input.aliases ?? [], ...stamp });
      await logChange(tx, actor, { ...entry, entityId: id, field: "created", newValue: input.term });
      return { id, created: true };
    }
    await tx.update(glossaryTerm).set({ ...input, aliases: input.aliases ?? existing.aliases, ...stamp }).where(eq(glossaryTerm.id, existing.id));
    if (existing.definition !== input.definition) {
      await logChange(tx, actor, { ...entry, entityId: existing.id, field: "definition", oldValue: existing.definition, newValue: input.definition });
    }
    return { id: existing.id, created: false };
  });
}

/**
 * Deletes a term, ignoring case, and logs it. Editor or higher.
 *
 * @throws NotFoundError if the project has no such term
 */
export async function deleteGlossaryTerm(db: Db, actor: Actor, projectSlug: string, term: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    await lockProject(tx, project.id);
    const existing = await findTerm(tx, project.id, term);
    if (!existing) throw new NotFoundError(`Unknown glossary term ${term}.`);
    await tx.delete(glossaryTerm).where(eq(glossaryTerm.id, existing.id));
    await logChange(tx, actor, { projectId: project.id, entity: "glossary", entityId: existing.id, field: "deleted", oldValue: existing.term });
  });
}
