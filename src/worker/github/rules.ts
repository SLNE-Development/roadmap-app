import { and, asc, eq, inArray } from "drizzle-orm";
import { board, boardColumn, codeLink, githubAccount, githubRepo, project, projectMember, system, task, type GitHubRepoRow } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { GitHubApi } from "@/lib/github/api";
import type { GitHubEventJob } from "@/lib/github/webhook";
import { withAgent, type Actor } from "@/lib/ops/actor";
import { ConflictError, OpError } from "@/lib/ops/errors";
import { notify } from "@/lib/ops/notifications";
import { moveSystem } from "@/lib/ops/systems";
import { updateTask } from "@/lib/ops/tasks";
import { loadActor } from "@/lib/ops/users";
import type { WorkerDeps } from "../deps";
import type { PullRequestLink } from "./pulls";

/** Note of a rule that had work but no one to do it as; the delivery then ends `skipped`. */
export const NO_ACTOR_NOTE = "skipped: no one to act as";

const AGENT = "GitHub";
const MAX_NOTE = 200;
const REVIEWABLE = new Set(["todo", "active", "blocked"]);

/** The parts of a `pull_request` payload the rules read. */
interface RulePayload {
  action?: string;
  pull_request?: { number: number; title: string; merged?: boolean | null; draft?: boolean | null; user?: { id?: number } | null };
}

/** Returns the user as an actor through the GitHub agent when they are still provisioned and an editor or owner of the project. */
async function editorActor(db: Executor, projectId: string, userId: string): Promise<Actor | null> {
  const actor = await loadActor(db, userId);
  if (!actor) return null;
  const [member] = await db
    .select({ role: projectMember.role })
    .from(projectMember)
    .where(and(eq(projectMember.projectId, projectId), eq(projectMember.userId, userId)));
  return member && (member.role === "editor" || member.role === "owner") ? withAgent(actor, AGENT) : null;
}

/**
 * Who automated changes of a repository are attributed to: the author of the pull request when their linked GitHub
 * account belongs to a project editor or owner, else the user who linked the repository under the same test, else no one.
 * Admins who aren't members are never used.
 */
export async function automationActor(db: Executor, repo: GitHubRepoRow, authorGithubId: number | null): Promise<Actor | null> {
  if (authorGithubId !== null) {
    const [account] = await db.select({ userId: githubAccount.userId }).from(githubAccount).where(eq(githubAccount.githubId, authorGithubId));
    const actor = account ? await editorActor(db, repo.projectId, account.userId) : null;
    if (actor) return actor;
  }
  return repo.createdBy ? editorActor(db, repo.projectId, repo.createdBy) : null;
}

/** The slug of a project. */
async function slugOf(db: Executor, projectId: string): Promise<string> {
  const [row] = await db.select({ slug: project.slug }).from(project).where(eq(project.id, projectId));
  return row.slug;
}

const noteOf = (error: OpError) => error.message.slice(0, MAX_NOTE);

/** Sets the open tasks the pull request closes to done; returns the notes. */
async function closeOnMerge(deps: WorkerDeps, repo: GitHubRepoRow, authorId: number | null, links: PullRequestLink[]): Promise<string[]> {
  const ids = [...new Set(links.filter((l) => l.closes && l.taskId !== null).map((l) => l.taskId as number))];
  if (ids.length === 0) return [];
  const rows = await deps.db.select({ id: task.id, state: task.state }).from(task).where(inArray(task.id, ids));
  const todo = rows.filter((t) => t.state !== "done").map((t) => t.id);
  if (todo.length === 0) return [];
  const actor = await automationActor(deps.db, repo, authorId);
  if (!actor) return [NO_ACTOR_NOTE];
  const notes: string[] = [];
  for (const id of todo.sort((a, b) => a - b)) {
    try {
      await updateTask(deps.db, actor, id, { state: "done" });
      notes.push(`closed task ${id}`);
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      notes.push(`task ${id} not closed: ${noteOf(error)}`);
    }
  }
  return notes;
}

/** Moves the linked systems that are still being worked on into their board's first review column; returns the notes. */
async function reviewOnOpen(deps: WorkerDeps, repo: GitHubRepoRow, pr: { number: number }, authorId: number | null, links: PullRequestLink[]): Promise<string[]> {
  const systemIds = [...new Set(links.map((l) => l.systemId))];
  const rows = await deps.db
    .select({
      id: system.id,
      slug: system.slug,
      title: system.title,
      ownerUserId: system.ownerUserId,
      boardId: board.id,
      boardSlug: board.slug,
      category: boardColumn.category,
    })
    .from(system)
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .innerJoin(board, eq(board.id, system.boardId))
    .where(inArray(system.id, systemIds))
    .orderBy(asc(system.slug));
  const candidates = rows.filter((r) => REVIEWABLE.has(r.category));
  if (candidates.length === 0) return [];
  const actor = await automationActor(deps.db, repo, authorId);
  if (!actor) return [NO_ACTOR_NOTE];
  const projectSlug = await slugOf(deps.db, repo.projectId);
  const notes: string[] = [];
  for (const row of candidates) {
    const [review] = await deps.db
      .select({ id: boardColumn.id })
      .from(boardColumn)
      .where(and(eq(boardColumn.boardId, row.boardId), eq(boardColumn.category, "review")))
      .orderBy(asc(boardColumn.sortOrder))
      .limit(1);
    if (!review) {
      notes.push(`no review column on ${row.boardSlug}`);
      continue;
    }
    try {
      await moveSystem(deps.db, actor, projectSlug, row.slug, { column: review.id });
      notes.push(`moved ${row.slug} to review`);
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      notes.push(`blocked: ${noteOf(error)}`);
      if (row.ownerUserId) {
        await notify(deps.db, {
          userId: row.ownerUserId,
          projectId: repo.projectId,
          kind: "automation.blocked",
          entity: "system",
          entityId: row.id,
          title: `Could not move ${row.title} to review`,
          body: error.message,
          href: `/p/${projectSlug}/systems/${row.slug}`,
          sourceKey: `automation-blocked:${repo.id}:${pr.number}:${row.id}`,
        });
      }
    }
  }
  return notes;
}

/** Tells the owners of the linked tasks, else of the linked systems, that the pull request was merged. */
async function notifyMerged(deps: WorkerDeps, repo: GitHubRepoRow, pr: { number: number; title: string }, links: PullRequestLink[]): Promise<void> {
  const taskIds = links.flatMap((l) => (l.taskId === null ? [] : [l.taskId]));
  const systemIds = [...new Set(links.map((l) => l.systemId))];
  const systems = await deps.db
    .select({ id: system.id, slug: system.slug, ownerUserId: system.ownerUserId })
    .from(system)
    .where(inArray(system.id, systemIds));
  const systemById = new Map(systems.map((s) => [s.id, s]));
  const taskOwners =
    taskIds.length === 0
      ? []
      : await deps.db.select({ systemId: task.systemId, ownerUserId: task.ownerUserId }).from(task).where(inArray(task.id, taskIds));
  // Recipient -> the system they are told about.
  const recipients = new Map<string, string>();
  for (const t of taskOwners) if (t.ownerUserId && !recipients.has(t.ownerUserId)) recipients.set(t.ownerUserId, t.systemId);
  if (recipients.size === 0) for (const s of systems) if (s.ownerUserId && !recipients.has(s.ownerUserId)) recipients.set(s.ownerUserId, s.id);
  if (recipients.size === 0) return;
  const projectSlug = await slugOf(deps.db, repo.projectId);
  for (const [userId, systemId] of recipients) {
    const target = systemById.get(systemId);
    if (!target) continue;
    await notify(deps.db, {
      userId,
      projectId: repo.projectId,
      kind: "pr.merged",
      entity: "system",
      entityId: systemId,
      title: `PR #${pr.number} merged: ${pr.title}`,
      href: `/p/${projectSlug}/systems/${target.slug}`,
      sourceKey: `pr-merged:${repo.id}:${pr.number}`,
    });
  }
}

/**
 * Applies the repository's owner rules to a stored pull request event and notifies about a merge. Returns notes for
 * the delivery detail, such as `closed task 188`; {@link NO_ACTOR_NOTE} among them marks work nobody could do.
 */
export async function runPullRequestRules(job: GitHubEventJob, deps: WorkerDeps, _api: GitHubApi, links: PullRequestLink[]): Promise<string[]> {
  const payload = job.payload as RulePayload;
  const pr = payload.pull_request;
  if (!pr || links.length === 0) return [];
  const [repo] = await deps.db
    .select()
    .from(githubRepo)
    .innerJoin(codeLink, eq(codeLink.repoId, githubRepo.id))
    .where(eq(codeLink.id, links[0].id))
    .then((rows) => rows.map((r) => r.github_repo));
  if (!repo) return [];
  const authorId = typeof pr.user?.id === "number" ? pr.user.id : null;
  const notes: string[] = [];
  if (payload.action === "closed" && pr.merged) {
    if (repo.rules.closeOnMerge) notes.push(...(await closeOnMerge(deps, repo, authorId, links)));
    await notifyMerged(deps, repo, pr, links);
  }
  if ((payload.action === "opened" || payload.action === "ready_for_review") && !pr.draft && repo.rules.reviewOnOpen) {
    notes.push(...(await reviewOnOpen(deps, repo, pr, authorId, links)));
  }
  return notes;
}
