import { and, asc, eq, ilike, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { githubRepo, system, task } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import type { GitHubApi, PullRequestInfo } from "@/lib/github/api";
import { withRef } from "@/lib/github/pr-text";
import { parseRefs } from "@/lib/github/refs";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, NotFoundError } from "./errors";

/** Input of {@link linkPullRequest}: the pull request and the task or whole system to link it to. */
export const linkPullRequestInput = z.object({
  repoId: z.string().min(1),
  number: z.number().int().positive(),
  target: z.union([z.object({ taskId: z.number().int().positive() }), z.object({ systemSlug: z.string().min(1).max(64) })]),
  closes: z.boolean().default(false),
});

/** What the PR link picker shows: the pull request, what it already links and the open work to pick from. */
export interface PrLinkContext {
  repo: { id: string; fullName: string };
  pr: { number: number; title: string; state: "open" | "closed"; merged: boolean; url: string };
  /** The roadmap refs already in the pull request's title and body. */
  linked: { tasks: number[]; systems: string[] };
  /** Non-archived systems by title, with their tasks that are not done, by sort order. */
  systems: { slug: string; title: string; tasks: { id: number; title: string; state: string }[] }[];
}

/**
 * Loads the repository (it must belong to the project and be linked through the App with access) and its pull request.
 *
 * @throws NotFoundError if the repository is not in the project or the pull request does not exist
 * @throws ConflictError if the repository is not App-linked with access
 */
async function loadPullRequest(
  db: Executor,
  api: GitHubApi,
  projectId: string,
  repoId: string,
  number: number,
): Promise<{ repo: { id: string; fullName: string; installationId: number }; pr: PullRequestInfo }> {
  const [repo] = await db.select().from(githubRepo).where(eq(githubRepo.id, repoId));
  if (!repo || repo.projectId !== projectId) throw new NotFoundError("Unknown repository.");
  if (repo.mode !== "app" || repo.installationId === null || repo.access !== "ok") {
    throw new ConflictError("This repository isn't linked through the GitHub App.");
  }
  const pr = await api.getPullRequest(repo.installationId, repo.fullName, number);
  if (!pr) throw new NotFoundError("Unknown pull request.");
  return { repo: { id: repo.id, fullName: repo.fullName, installationId: repo.installationId }, pr };
}

/**
 * The data of the PR link picker. Editor or higher.
 *
 * @throws NotFoundError for an unknown pull request or a repository outside the project
 * @throws ConflictError when the repository isn't App-linked with access
 */
export async function pullRequestLinkContext(
  db: Db,
  api: GitHubApi,
  actor: Actor,
  projectSlug: string,
  repoId: string,
  number: number,
): Promise<PrLinkContext> {
  const { project } = await projectAccess(db, actor, projectSlug, "editor");
  const { repo, pr } = await loadPullRequest(db, api, project.id, repoId, number);
  const rows = await db
    .select({ slug: system.slug, title: system.title, taskId: task.id, taskTitle: task.title, state: task.state })
    .from(system)
    .leftJoin(task, and(eq(task.systemId, system.id), ne(task.state, "done")))
    .where(and(eq(system.projectId, project.id), isNull(system.archivedAt)))
    .orderBy(asc(system.title), asc(system.id), asc(task.sortOrder), asc(task.id));
  const systems: PrLinkContext["systems"] = [];
  for (const row of rows) {
    let entry = systems.at(-1);
    if (!entry || entry.slug !== row.slug) {
      entry = { slug: row.slug, title: row.title, tasks: [] };
      systems.push(entry);
    }
    if (row.taskId !== null) entry.tasks.push({ id: row.taskId, title: row.taskTitle!, state: row.state! });
  }
  return {
    repo: { id: repo.id, fullName: repo.fullName },
    pr: { number, title: pr.title, state: pr.state, merged: pr.merged, url: pr.htmlUrl },
    linked: parseRefs(`${pr.title}\n${pr.body}`),
    systems,
  };
}

/**
 * Adds the target's roadmap ref to the pull request: in the title when `closes` (so merging closes the task),
 * otherwise on the body's `Roadmap:` line. Editor or higher.
 *
 * @returns `changed: false` when the ref is already in the title or body
 * @throws NotFoundError for an unknown pull request, a repository outside the project, or a task or system not in it
 * @throws ConflictError when the repository isn't App-linked with access
 */
export async function linkPullRequest(
  db: Db,
  api: GitHubApi,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof linkPullRequestInput>,
): Promise<{ changed: boolean; ref: string }> {
  const input = linkPullRequestInput.parse(raw);
  const { project } = await projectAccess(db, actor, projectSlug, "editor");
  const { repo, pr } = await loadPullRequest(db, api, project.id, input.repoId, input.number);
  let ref: string;
  if ("taskId" in input.target) {
    const [row] = await db
      .select({ id: task.id })
      .from(task)
      .innerJoin(system, eq(system.id, task.systemId))
      .where(and(eq(task.id, input.target.taskId), eq(system.projectId, project.id), isNull(system.archivedAt)));
    if (!row) throw new NotFoundError("Unknown task.");
    ref = `roadmap#${row.id}`;
  } else {
    const [row] = await db
      .select({ slug: system.slug })
      .from(system)
      .where(and(eq(system.slug, input.target.systemSlug), eq(system.projectId, project.id), isNull(system.archivedAt)));
    if (!row) throw new NotFoundError("Unknown system.");
    ref = `roadmap:${row.slug}`;
  }
  const patch = withRef(pr, ref, input.closes);
  if (!patch) return { changed: false, ref };
  await api.updatePullRequest(repo.installationId, repo.fullName, input.number, patch);
  return { changed: true, ref };
}

/**
 * Open (not done) tasks of the project's non-archived systems whose title contains `query`, case-insensitive,
 * by title, at most `limit`. `%` and `_` in the query match themselves.
 */
export async function searchOpenTasks(
  db: Executor,
  projectId: string,
  query: string,
  limit: number,
): Promise<{ id: number; title: string; systemTitle: string; systemSlug: string }[]> {
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  return db
    .select({ id: task.id, title: task.title, systemTitle: system.title, systemSlug: system.slug })
    .from(task)
    .innerJoin(system, eq(system.id, task.systemId))
    .where(and(eq(system.projectId, projectId), isNull(system.archivedAt), ne(task.state, "done"), ilike(task.title, pattern)))
    .orderBy(asc(task.title), asc(task.id))
    .limit(limit);
}
