import { and, eq, notInArray } from "drizzle-orm";
import { codeLink, githubRepo, type CodeLinkRow, type GitHubRepoRow } from "@/db/schema";
import type { Executor } from "@/db/types";
import { parseRefs, type Refs } from "@/lib/github/refs";
import type { GitHubEventJob } from "@/lib/github/webhook";
import type { Actor } from "@/lib/ops/actor";
import { refKeyOf, resolveRefs, targetKeyOf, upsertCodeLink, type CodeLinkInput } from "@/lib/ops/github-links";
import { logChange } from "@/lib/ops/log";
import { plural } from "@/lib/text";
import { onGitHubEvent, type DeliveryOutcome } from "./events";
import { syncPrComment } from "./pr-comment";
import { automationActor, NO_ACTOR_NOTE, runPullRequestRules } from "./rules";

/** The parts of `payload.repository` the handlers read. */
export interface RepositoryPayload {
  id?: number;
  full_name?: string;
}

/** The parts of a `pull_request` payload the handler reads. */
interface PullRequestPayload {
  action?: string;
  repository?: RepositoryPayload;
  pull_request?: {
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    state: string;
    merged?: boolean | null;
    draft?: boolean | null;
    head?: { sha?: string };
    user?: { login?: string; id?: number } | null;
  };
}

/** The parts of a `push` payload the handler reads. */
interface PushPayload {
  deleted?: boolean;
  repository?: RepositoryPayload;
  sender?: { id?: number } | null;
  commits?: { id: string; message: string; url: string; author?: { username?: string } | null }[];
}

/** A task or system a pull request or commit links to. */
interface Target {
  systemId: string;
  taskId: number | null;
  closes: boolean;
}

/** A link stored for a pull request, handed to the owner rules. */
export interface PullRequestLink extends Target {
  id: string;
  created: boolean;
  previous: CodeLinkRow | null;
}

type UpsertResult = Awaited<ReturnType<typeof upsertCodeLink>>;

const HANDLED_ACTIONS = new Set(["opened", "reopened", "edited", "synchronize", "ready_for_review", "closed"]);
const MAX_COMMITS = 100;
const MAX_TITLE = 200;
const NOT_LINKED: DeliveryOutcome = { status: "ignored", detail: "repository not linked" };
const LINKED_BY_HAND: DeliveryOutcome = { status: "ignored", detail: "linked by hand" };
const GITHUB_URL = "https://github.com/";

/** Returns the App deliveries' own repos: a repo linked by hand (webhook mode) is handled by its manual webhook only. */
export function handBlocked(job: GitHubEventJob, repo: GitHubRepoRow): DeliveryOutcome | null {
  return job.source === "app" && repo.mode !== "app" ? LINKED_BY_HAND : null;
}

/** Returns `url` when it points to GitHub, else `fallback`; only GitHub URLs are stored on code links. */
const githubUrl = (url: string | undefined, fallback: string): string => (url?.startsWith(GITHUB_URL) ? url : fallback);

/**
 * Finds the linked repository of a delivery: the job's repo for a manual webhook, else the repo with the
 * payload's GitHub id or, failing that, its full name.
 */
export async function findRepo(db: Executor, job: GitHubEventJob, repository: RepositoryPayload | undefined): Promise<GitHubRepoRow | null> {
  if (job.source === "repo") {
    if (!job.repoId) return null;
    const [row] = await db.select().from(githubRepo).where(eq(githubRepo.id, job.repoId));
    return row ?? null;
  }
  if (typeof repository?.id === "number") {
    const [row] = await db.select().from(githubRepo).where(eq(githubRepo.githubRepoId, repository.id));
    if (row) return row;
  }
  if (typeof repository?.full_name !== "string") return null;
  const [row] = await db.select().from(githubRepo).where(eq(githubRepo.fullNameKey, repository.full_name.toLowerCase()));
  return row ?? null;
}

/** Resolves `refs` in the project to link targets, each with `closes`. */
async function targetsOf(tx: Executor, projectId: string, refs: Refs, closes: boolean): Promise<Target[]> {
  const resolved = await resolveRefs(tx, projectId, refs);
  return [
    ...resolved.tasks.map((t) => ({ systemId: t.systemId, taskId: t.taskId, closes })),
    ...resolved.systems.map((s) => ({ systemId: s.systemId, taskId: null, closes })),
  ];
}

/** The outcome detail for the tasks and systems a delivery linked. */
function linkedDetail(tasks: number, systems: number): string {
  return tasks + systems === 0 ? "no roadmap references" : `linked ${plural(tasks, "task")}, ${plural(systems, "system")}`;
}

/**
 * Records a new link (`code`/`created`) or a state change (`code`/`state`) in the change log. Code links aren't
 * user actions, so without an actor to attribute them to nothing is logged and the link is stored all the same.
 */
async function logLink(tx: Executor, actor: Actor | null, input: CodeLinkInput, result: UpsertResult): Promise<void> {
  if (!actor) return;
  const base = { projectId: input.projectId, systemId: input.systemId, entity: "code", entityId: result.id };
  if (result.created) {
    const label = input.kind === "pr" ? `PR #${input.number}` : `Commit ${input.sha?.slice(0, 7)}`;
    await logChange(tx, actor, { ...base, field: "created", newValue: label });
  } else if (result.previous && result.previous.state !== input.state) {
    await logChange(tx, actor, { ...base, field: "state", oldValue: result.previous.state, newValue: input.state });
  }
}

onGitHubEvent("pull_request", async (job, deps, api) => {
  const payload = job.payload as PullRequestPayload;
  const pr = payload.pull_request;
  const action = payload.action ?? "";
  if (!pr || !HANDLED_ACTIONS.has(action)) return { status: "ignored", detail: `pull_request.${action || "?"}` };
  const repo = await findRepo(deps.db, job, payload.repository);
  if (!repo) return NOT_LINKED;
  const blocked = handBlocked(job, repo);
  if (blocked) return blocked;

  const state = pr.merged ? "merged" : pr.state === "closed" ? "closed" : "open";
  const resetChecks = repo.mode === "app" && (action === "opened" || action === "synchronize");
  const actor = await automationActor(deps.db, repo, pr.user?.id ?? null);

  const result = await deps.db.transaction(async (tx) => {
    // A reference in both the title and the body counts as the title's.
    const fromTitle = await targetsOf(tx, repo.projectId, parseRefs(pr.title), true);
    const titleKeys = new Set(fromTitle.map(targetKeyOf));
    const fromBody = (await targetsOf(tx, repo.projectId, parseRefs(pr.body ?? ""), false)).filter((t) => !titleKeys.has(targetKeyOf(t)));
    const targets = [...fromTitle, ...fromBody];

    const stored: PullRequestLink[] = [];
    for (const target of targets) {
      const input: CodeLinkInput = {
        projectId: repo.projectId,
        systemId: target.systemId,
        taskId: target.taskId,
        repoId: repo.id,
        kind: "pr",
        number: pr.number,
        sha: pr.head?.sha ?? null,
        title: pr.title.slice(0, MAX_TITLE),
        url: githubUrl(pr.html_url, `${GITHUB_URL}${repo.fullName}/pull/${pr.number}`),
        state,
        ...(resetChecks && { checks: "pending" as const }),
        closes: target.closes,
        authorLogin: pr.user?.login ?? null,
      };
      const result = await upsertCodeLink(tx, input);
      await logLink(tx, actor, input, result);
      stored.push({ ...target, ...result });
    }
    let removed = 0;
    if (action === "edited") {
      const kept = targets.map(targetKeyOf);
      const deleted = await tx
        .delete(codeLink)
        .where(
          and(
            eq(codeLink.repoId, repo.id),
            eq(codeLink.refKey, refKeyOf({ kind: "pr", number: pr.number, sha: null })),
            ...(kept.length > 0 ? [notInArray(codeLink.targetKey, kept)] : []),
          ),
        )
        .returning({ id: codeLink.id });
      removed = deleted.length;
    }
    return { stored, removed };
  });
  const links = result.stored;

  const notes = await runPullRequestRules(job, deps, api, links);
  if (links.some((l) => l.created) || result.removed > 0 || (action === "opened" && links.length > 0)) {
    const note = await syncPrComment(deps, api, repo, pr.number);
    if (note) notes.push(note);
  }
  const tasks = links.filter((l) => l.taskId !== null).length;
  const detail = [linkedDetail(tasks, links.length - tasks), ...notes].join("; ");
  return { status: notes.includes(NO_ACTOR_NOTE) ? "skipped" : "done", detail };
});

onGitHubEvent("push", async (job, deps) => {
  const payload = job.payload as PushPayload;
  if (payload.deleted === true) return { status: "ignored", detail: "branch deleted" };
  const repo = await findRepo(deps.db, job, payload.repository);
  if (!repo) return NOT_LINKED;
  const blocked = handBlocked(job, repo);
  if (blocked) return blocked;
  const actor = await automationActor(deps.db, repo, payload.sender?.id ?? null);

  const tasks = new Set<number>();
  const systems = new Set<string>();
  await deps.db.transaction(async (tx) => {
    for (const commit of (payload.commits ?? []).slice(0, MAX_COMMITS)) {
      for (const target of await targetsOf(tx, repo.projectId, parseRefs(commit.message), false)) {
        const input: CodeLinkInput = {
          projectId: repo.projectId,
          systemId: target.systemId,
          taskId: target.taskId,
          repoId: repo.id,
          kind: "commit",
          number: null,
          sha: commit.id,
          title: commit.message.split("\n", 1)[0].slice(0, MAX_TITLE),
          url: githubUrl(commit.url, `${GITHUB_URL}${repo.fullName}/commit/${commit.id}`),
          state: "merged",
          closes: false,
          authorLogin: commit.author?.username ?? null,
        };
        await logLink(tx, actor, input, await upsertCodeLink(tx, input));
        if (target.taskId !== null) tasks.add(target.taskId);
        else systems.add(target.systemId);
      }
    }
  });
  return { status: "done", detail: linkedDetail(tasks.size, systems.size) };
});
