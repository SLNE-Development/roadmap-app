import { and, desc, eq, isNotNull, max } from "drizzle-orm";
import { z } from "zod";
import { systemDocument, task, user, type DocumentKind } from "@/db/schema";
import type { Db, Executor, Tx } from "@/db/types";
import { newId } from "@/lib/id";
import { projectAccess } from "./access";
import { authorLabel, type Actor } from "./actor";
import { NotFoundError } from "./errors";
import { logChange } from "./log";
import { findSystem, systemAccess, type SystemRow } from "./lookup";

/** Markdown body of a spec or plan. */
const bodySchema = z.string().trim().min(1).max(200_000);

/** Input of {@link writeSpec}. */
export const writeSpecInput = z.object({ body: bodySchema });

/** Input of {@link writePlan}: the markdown plan and its numbered steps. */
export const writePlanInput = z.object({
  body: bodySchema,
  steps: z
    .array(z.object({ step: z.number().int().min(1).max(500), title: z.string().trim().min(1).max(200) }))
    .min(1)
    .max(200)
    .refine((steps) => new Set(steps.map((s) => s.step)).size === steps.length, "step numbers must be unique"),
});

/** A version of a system document with the list of all its versions, newest first. */
export interface DocumentView {
  kind: DocumentKind;
  version: number;
  body: string;
  author: string;
  createdAt: Date;
  versions: number[];
}

/** What {@link writePlan} changed in the task list. */
export interface PlanSync {
  version: number;
  createdTasks: number[];
  renamedTasks: number[];
  missingSteps: number[];
}

/** Loads the given version (or the latest) of a system document, or `null` when there is none. */
async function loadDocument(db: Executor, systemId: string, kind: DocumentKind, version?: number): Promise<DocumentView | null> {
  const versions = (
    await db
      .select({ version: systemDocument.version })
      .from(systemDocument)
      .where(and(eq(systemDocument.systemId, systemId), eq(systemDocument.kind, kind)))
      .orderBy(desc(systemDocument.version))
  ).map((v) => v.version);
  const wanted = version ?? versions[0];
  if (wanted === undefined) return null;
  const [row] = await db
    .select({ body: systemDocument.body, createdAt: systemDocument.createdAt, agent: systemDocument.agent, authorName: user.name })
    .from(systemDocument)
    .leftJoin(user, eq(user.id, systemDocument.authorUserId))
    .where(and(eq(systemDocument.systemId, systemId), eq(systemDocument.kind, kind), eq(systemDocument.version, wanted)))
    .limit(1);
  if (!row) return null;
  return { kind, version: wanted, body: row.body, author: authorLabel(row.authorName, row.agent), createdAt: row.createdAt, versions };
}

/** Returns the latest version of a system document, or `null`. */
export function latestDocument(db: Executor, systemId: string, kind: DocumentKind): Promise<DocumentView | null> {
  return loadDocument(db, systemId, kind);
}

/**
 * Returns a version of a system's spec or plan (the latest when `version` is omitted), or `null` when none exists.
 *
 * @throws NotFoundError for an unknown version
 */
export async function getDocument(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  kind: DocumentKind,
  version?: number,
): Promise<DocumentView | null> {
  const { system } = await systemAccess(db, actor, projectSlug, systemSlug, "viewer");
  const found = await loadDocument(db, system.id, kind, version);
  if (!found && version !== undefined) throw new NotFoundError(`System ${systemSlug} has no ${kind} version ${version}.`);
  return found;
}

/** Appends the next version of a document; the caller holds the lock on the system row. */
async function appendVersion(tx: Tx, actor: Actor, parent: SystemRow, kind: DocumentKind, body: string): Promise<number> {
  const [{ last }] = await tx
    .select({ last: max(systemDocument.version) })
    .from(systemDocument)
    .where(and(eq(systemDocument.systemId, parent.id), eq(systemDocument.kind, kind)));
  const version = (last ?? 0) + 1;
  await tx.insert(systemDocument).values({
    id: newId(),
    systemId: parent.id,
    kind,
    version,
    body,
    authorUserId: actor.userId,
    agent: actor.agent ?? null,
  });
  await logChange(tx, actor, { projectId: parent.projectId, systemId: parent.id, entity: "document", entityId: parent.id, field: kind, newValue: `v${version}` });
  return version;
}

/** Writes a new version of a system's spec. Editor or higher. */
export async function writeSpec(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof writeSpecInput>,
): Promise<{ version: number }> {
  const input = writeSpecInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const parent = await findSystem(tx, project.id, systemSlug, true);
    return { version: await appendVersion(tx, actor, parent, "spec", input.body) };
  });
}

/**
 * Writes a new version of a system's plan and syncs its steps into tasks: a step
 * without a task gets one, a step whose title changed renames its task, and tasks
 * of steps no longer in the plan are kept and reported. Editor or higher.
 */
export async function writePlan(
  db: Db,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  raw: z.input<typeof writePlanInput>,
): Promise<PlanSync> {
  const input = writePlanInput.parse(raw);
  return db.transaction(async (tx) => {
    const { project } = await projectAccess(tx, actor, projectSlug, "editor");
    const parent = await findSystem(tx, project.id, systemSlug, true);
    const version = await appendVersion(tx, actor, parent, "plan", input.body);
    const existing = await tx
      .select({ id: task.id, title: task.title, planStep: task.planStep })
      .from(task)
      .where(and(eq(task.systemId, parent.id), isNotNull(task.planStep)));
    const byStep = new Map(existing.map((t) => [t.planStep as number, t]));
    const [{ last }] = await tx.select({ last: max(task.sortOrder) }).from(task).where(eq(task.systemId, parent.id));
    let order = (last ?? -1) + 1;
    const createdTasks: number[] = [];
    const renamedTasks: number[] = [];
    for (const step of [...input.steps].sort((a, b) => a.step - b.step)) {
      const current = byStep.get(step.step);
      if (!current) {
        const [row] = await tx
          .insert(task)
          .values({ systemId: parent.id, title: step.title, priority: parent.priority, planStep: step.step, sortOrder: order++ })
          .returning({ id: task.id });
        createdTasks.push(row.id);
        await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "task", entityId: row.id, field: "created", newValue: step.title });
      } else if (current.title !== step.title) {
        await tx.update(task).set({ title: step.title }).where(eq(task.id, current.id));
        renamedTasks.push(current.id);
        await logChange(tx, actor, { projectId: project.id, systemId: parent.id, entity: "task", entityId: current.id, field: "title", oldValue: current.title, newValue: step.title });
      }
    }
    const listed = new Set(input.steps.map((s) => s.step));
    const missingSteps = [...byStep.keys()].filter((s) => !listed.has(s)).sort((a, b) => a - b);
    return { version, createdTasks, renamedTasks, missingSteps };
  });
}
