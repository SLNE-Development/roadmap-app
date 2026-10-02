import { and, eq, inArray } from "drizzle-orm";
import { project, system, type GitHubRepoRow } from "@/db/schema";
import { parseRoadmapCommand } from "@/lib/github/command";
import { withRef } from "@/lib/github/pr-text";
import { parseRefs } from "@/lib/github/refs";
import { resolveRefs } from "@/lib/ops/github-links";
import { searchOpenTasks } from "@/lib/ops/github-pr";
import { plural } from "@/lib/text";
import type { WorkerDeps } from "../deps";
import { onGitHubEvent, type DeliveryOutcome } from "./events";
import { escapeMarkdown, isTrustedAssociation, pickUrlOf, syncPrComment } from "./pr-comment";
import { findRepo, handBlocked, NOT_LINKED, type RepositoryPayload } from "./pulls";

/** The parts of an `issue_comment` payload the handler reads. */
interface IssueCommentPayload {
  action?: string;
  repository?: RepositoryPayload;
  issue?: { number: number; pull_request?: object; user?: { id?: number } | null; author_association?: string };
  comment?: {
    body?: string;
    author_association?: string;
    user?: { id?: number; type?: string } | null;
    performed_via_github_app?: object | null;
  };
}

const SEARCH_LIMIT = 6;
const LISTED = 5;
const MAX_QUERY = 80;
const MAX_ERROR = 120;

/** Returns a note for the delivery detail when a GitHub call of the command failed. */
function failureNote(action: string, error: unknown): string {
  console.error(`github: ${action} failed`, error);
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === "number") return `${action} skipped: GitHub refused (${status})`;
  const message = error instanceof Error ? error.message : String(error);
  return `${action} skipped: ${message.slice(0, MAX_ERROR)}`;
}

/** The refs a query names, and the notice for those that aren't a task or system of the project. */
async function refsOfQuery(deps: WorkerDeps, repo: GitHubRepoRow, query: string): Promise<{ refs: string[]; notice: string | null } | null> {
  const parsed = parseRefs(query);
  if (parsed.tasks.length + parsed.systems.length === 0) return null;
  const resolved = await resolveRefs(deps.db, repo.projectId, parsed);
  const systemRows =
    resolved.systems.length === 0
      ? []
      : await deps.db
          .select({ slug: system.slug })
          .from(system)
          .where(and(eq(system.projectId, repo.projectId), inArray(system.id, resolved.systems.map((s) => s.systemId))));
  const taskIds = new Set(resolved.tasks.map((t) => t.taskId));
  const slugs = new Set(systemRows.map((s) => s.slug));
  const refs = [...parsed.tasks.filter((id) => taskIds.has(id)).map((id) => `roadmap#${id}`), ...parsed.systems.filter((s) => slugs.has(s)).map((s) => `roadmap:${s}`)];
  const missing = [...parsed.tasks.filter((id) => !taskIds.has(id)).map((id) => `roadmap#${id}`), ...parsed.systems.filter((s) => !slugs.has(s)).map((s) => `roadmap:${s}`)];
  const notice = missing.length === 0 ? null : missing.map((ref) => `\`${ref}\` isn't a task or system of this project.`).join("\n");
  return { refs, notice };
}

onGitHubEvent("issue_comment", async (job, deps, api): Promise<DeliveryOutcome> => {
  const payload = job.payload as IssueCommentPayload;
  const action = payload.action ?? "";
  if (action !== "created") return { status: "ignored", detail: `issue_comment.${action || "?"}` };
  const issue = payload.issue;
  const comment = payload.comment;
  if (!issue || !comment || !issue.pull_request) return { status: "ignored", detail: "not a pull request" };
  const command = parseRoadmapCommand(comment.body ?? "");
  if (!command) return { status: "ignored", detail: "no command" };
  if (comment.user?.type === "Bot" || comment.performed_via_github_app) return { status: "ignored", detail: "bot comment" };
  const isAuthor = typeof comment.user?.id === "number" && comment.user.id === issue.user?.id;
  const trustedCommenter = isTrustedAssociation(comment.author_association);
  if (!trustedCommenter && !isAuthor) return { status: "ignored", detail: "not allowed" };

  const repo = await findRepo(deps.db, job, payload.repository);
  if (!repo) return NOT_LINKED;
  const blocked = handBlocked(job, repo);
  if (blocked) return blocked;
  if (repo.mode !== "app" || repo.installationId === null || repo.access !== "ok") {
    return { status: "ignored", detail: "repository not linked through the app" };
  }
  const installationId = repo.installationId;
  const number = issue.number;
  const [owner] = await deps.db.select({ slug: project.slug }).from(project).where(eq(project.id, repo.projectId));
  const pickUrl = pickUrlOf(owner?.slug ?? "", repo.id, number);
  // An untrusted PR author only gets the picker link: no search and no ref resolution, which would be an oracle for task titles and ids.
  const query = trustedCommenter ? command.query.trim() : "";
  const syncOptions = { showTitles: payload.repository?.private === true || isTrustedAssociation(issue.author_association) };

  if (query === "") {
    const note = await syncPrComment(deps, api, repo, number, `Pick the task for this pull request: [open the roadmap picker](${pickUrl}).`, syncOptions);
    return { status: "done", detail: ["picker offered", ...(note ? [note] : [])].join("; ") };
  }

  let refs: string[] = [];
  let notice: string | null = null;
  const named = await refsOfQuery(deps, repo, query);
  if (named) {
    ({ refs, notice } = named);
  } else {
    const shown = escapeMarkdown(query.slice(0, MAX_QUERY));
    const hits = await searchOpenTasks(deps.db, repo.projectId, query, SEARCH_LIMIT);
    if (hits.length === 1) refs = [`roadmap#${hits[0].id}`];
    else if (hits.length === 0) notice = `No open task matches "${shown}". [Pick one on the roadmap](${pickUrl}).`;
    else {
      const lines = hits.slice(0, LISTED).map((h) => `- \`roadmap#${h.id}\` ${escapeMarkdown(h.title)} · ${escapeMarkdown(h.systemTitle)}`);
      notice = [`Several tasks match "${shown}":`, ...lines, `Comment \`/roadmap roadmap#${hits[0].id}\` or [pick one on the roadmap](${pickUrl}).`].join("\n");
    }
  }

  const notes: string[] = [];
  let detail = "";
  if (refs.length > 0) {
    try {
      const pr = await api.getPullRequest(installationId, repo.fullName, number);
      if (!pr) {
        detail = "pull request not found";
      } else {
        const current = { title: pr.title, body: pr.body ?? "" };
        let applied = 0;
        for (const ref of refs) {
          const patch = withRef(current, ref, false);
          if (!patch) continue;
          Object.assign(current, patch);
          applied += 1;
        }
        if (applied > 0) await api.updatePullRequest(installationId, repo.fullName, number, { body: current.body });
        detail = applied > 0 ? `added ${plural(applied, "ref")}` : "no new refs";
      }
    } catch (error) {
      notes.push(failureNote("pull request edit", error));
    }
  }
  if (notice) {
    const note = await syncPrComment(deps, api, repo, number, notice, syncOptions);
    if (note) notes.push(note);
    if (!detail) detail = "notice posted";
  }
  return { status: "done", detail: [detail, ...notes].filter(Boolean).join("; ") };
});
