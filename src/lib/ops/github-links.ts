import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { codeLink, githubAccount, githubRepo, system, task, user, type CodeLinkRow } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { Refs } from "@/lib/github/refs";
import { newId } from "@/lib/id";
import type { Actor } from "./actor";
import { systemAccess } from "./lookup";

/** A pull request or commit to link to one task or system; `checks` left undefined keeps the stored value. */
export interface CodeLinkInput {
  projectId: string;
  systemId: string;
  taskId: number | null;
  repoId: string;
  kind: "pr" | "commit";
  number: number | null;
  sha: string | null;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  checks?: "pending" | "success" | "failure" | null;
  closes: boolean;
  authorLogin: string | null;
}

/** A code link as the system page shows it. */
export interface CodeLinkView {
  kind: "pr" | "commit";
  number: number | null;
  sha: string | null;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  checks: "pending" | "success" | "failure" | null;
  taskId: number | null;
  repoFullName: string;
  authorLogin: string | null;
  /** The name of the member whose linked GitHub account is the author. */
  authorName: string | null;
  updatedAt: Date;
}

/** The `ref_key` of a link: `pr:<number>` or `commit:<sha>`. */
export function refKeyOf(input: Pick<CodeLinkInput, "kind" | "number" | "sha">): string {
  return input.kind === "pr" ? `pr:${input.number}` : `commit:${input.sha}`;
}

/** The `target_key` of a link: `task:<id>`, or `system:<systemId>` for a link to the system itself. */
export function targetKeyOf(input: Pick<CodeLinkInput, "taskId" | "systemId">): string {
  return input.taskId !== null ? `task:${input.taskId}` : `system:${input.systemId}`;
}

/**
 * Stores a code link, or updates the one with the same repository, ref and target.
 *
 * @returns the link id, whether it was new, and the row as it was before an update
 */
export async function upsertCodeLink(
  tx: Executor,
  input: CodeLinkInput,
): Promise<{ id: string; created: boolean; previous: CodeLinkRow | null }> {
  const refKey = refKeyOf(input);
  const targetKey = targetKeyOf(input);
  const [previous] = await tx
    .select()
    .from(codeLink)
    .where(and(eq(codeLink.repoId, input.repoId), eq(codeLink.refKey, refKey), eq(codeLink.targetKey, targetKey)))
    .for("update");
  const values = {
    systemId: input.systemId,
    number: input.number,
    sha: input.sha,
    title: input.title,
    url: input.url,
    state: input.state,
    ...(input.checks !== undefined && { checks: input.checks }),
    closes: input.closes,
    authorLogin: input.authorLogin,
  };
  if (previous) {
    await tx
      .update(codeLink)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(codeLink.id, previous.id));
    return { id: previous.id, created: false, previous };
  }
  const id = newId();
  await tx.insert(codeLink).values({ id, projectId: input.projectId, taskId: input.taskId, repoId: input.repoId, kind: input.kind, refKey, targetKey, ...values });
  return { id, created: true, previous: null };
}

/**
 * Resolves parsed references to the tasks and systems of one project; references to anything else, including
 * another project's tasks, and to archived systems are dropped silently.
 */
export async function resolveRefs(
  tx: Executor,
  projectId: string,
  refs: Refs,
): Promise<{ tasks: { taskId: number; systemId: string }[]; systems: { systemId: string }[] }> {
  const inProject = and(eq(system.projectId, projectId), isNull(system.archivedAt));
  const taskRows =
    refs.tasks.length === 0
      ? []
      : await tx
          .select({ taskId: task.id, systemId: task.systemId })
          .from(task)
          .innerJoin(system, eq(system.id, task.systemId))
          .where(and(inProject, inArray(task.id, refs.tasks)));
  const systemRows =
    refs.systems.length === 0
      ? []
      : await tx
          .select({ systemId: system.id, slug: system.slug })
          .from(system)
          .where(and(inProject, inArray(system.slug, refs.systems)));
  const taskById = new Map(taskRows.map((t) => [t.taskId, t]));
  const systemBySlug = new Map(systemRows.map((s) => [s.slug, s.systemId]));
  return {
    tasks: refs.tasks.flatMap((id) => taskById.get(id) ?? []),
    systems: refs.systems.flatMap((slug) => {
      const systemId = systemBySlug.get(slug);
      return systemId ? [{ systemId }] : [];
    }),
  };
}

/**
 * Lists the code links of a system, newest first.
 *
 * @throws NotFoundError if the actor cannot see the project or the system does not exist
 */
export async function linksForSystem(db: Db, actor: Actor, projectSlug: string, systemSlug: string): Promise<CodeLinkView[]> {
  const { system: row } = await systemAccess(db, actor, projectSlug, systemSlug, "viewer");
  return db
    .select({
      kind: codeLink.kind,
      number: codeLink.number,
      sha: codeLink.sha,
      title: codeLink.title,
      url: codeLink.url,
      state: codeLink.state,
      checks: codeLink.checks,
      taskId: codeLink.taskId,
      repoFullName: githubRepo.fullName,
      authorLogin: codeLink.authorLogin,
      authorName: user.name,
      updatedAt: codeLink.updatedAt,
    })
    .from(codeLink)
    .innerJoin(githubRepo, eq(githubRepo.id, codeLink.repoId))
    // GitHub logins are case-insensitive.
    .leftJoin(githubAccount, sql`lower(${githubAccount.login}) = lower(${codeLink.authorLogin})`)
    .leftJoin(user, eq(user.id, githubAccount.userId))
    .where(eq(codeLink.systemId, row.id))
    .orderBy(desc(codeLink.updatedAt), desc(codeLink.id));
}
