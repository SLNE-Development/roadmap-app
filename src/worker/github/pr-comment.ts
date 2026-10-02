import { and, eq } from "drizzle-orm";
import { codeLink, project, system, task, type GitHubRepoRow } from "@/db/schema";
import type { GitHubApi } from "@/lib/github/api";
import { refKeyOf } from "@/lib/ops/github-links";
import { siteUrl } from "@/lib/site";
import type { WorkerDeps } from "../deps";

/** Hidden marker that identifies the App's comment on a pull request. */
export const COMMENT_MARKER = "<!-- roadmap-app:links -->";

const MAX_ERROR = 120;

/** One roadmap task or system a pull request is linked to, as listed in the comment. */
export interface CommentLink {
  ref: string;
  title: string;
  systemTitle: string | null;
  url: string;
  closes: boolean;
  done: boolean;
}

/** Returns the roadmap page where a person can pick a task to link to the pull request. */
export function pickUrlOf(projectSlug: string, repoId: string, number: number): string {
  return new URL(`/p/${projectSlug}/link-pr?repo=${encodeURIComponent(repoId)}&pr=${number}`, siteUrl()).toString();
}

/** Escapes markdown syntax in `text` and breaks `@mentions` with a zero-width space so a title can't format or ping anyone. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`\[\]*_<>]/g, "\\$&").replace(/@/g, "@\u200b");
}

/** Renders the comment body: always starts with {@link COMMENT_MARKER}. English only, as GitHub content has no viewer locale. */
export function renderPrComment(input: { links: CommentLink[]; notice: string | null; pickUrl: string }): string {
  const lines = [COMMENT_MARKER];
  if (input.links.length > 0) {
    lines.push("**Linked on the roadmap**", "");
    for (const l of input.links) {
      lines.push(`- [${escapeMarkdown(l.title)}](${l.url}) · \`${l.ref}\`${l.systemTitle ? ` · ${escapeMarkdown(l.systemTitle)}` : ""}${l.closes ? " · closes on merge" : ""}${l.done ? " · ✓ done" : ""}`);
    }
  } else {
    lines.push("_This pull request is no longer linked to the roadmap._");
  }
  if (input.notice) lines.push("", input.notice);
  lines.push("", `<sub>Comment \`/roadmap\` to link a task, or [pick one on the roadmap](${input.pickUrl}).</sub>`);
  return lines.join("\n");
}

/**
 * Brings the App's comment on the PR in line with its stored links. Does nothing for repos that aren't App-linked
 * with access, and creates no comment when there are no links and no notice. Never throws for GitHub errors;
 * returns a note for the delivery detail instead (null when nothing worth noting happened).
 */
export async function syncPrComment(deps: WorkerDeps, api: GitHubApi, repo: GitHubRepoRow, number: number, notice: string | null = null): Promise<string | null> {
  if (repo.mode !== "app" || repo.installationId === null || repo.access !== "ok") return null;
  const rows = await deps.db
    .select({
      taskId: codeLink.taskId,
      closes: codeLink.closes,
      taskTitle: task.title,
      taskState: task.state,
      systemSlug: system.slug,
      systemTitle: system.title,
      projectSlug: project.slug,
    })
    .from(codeLink)
    .leftJoin(task, eq(task.id, codeLink.taskId))
    .innerJoin(system, eq(system.id, codeLink.systemId))
    .innerJoin(project, eq(project.id, codeLink.projectId))
    .where(and(eq(codeLink.repoId, repo.id), eq(codeLink.refKey, refKeyOf({ kind: "pr", number, sha: null }))));

  const site = siteUrl();
  const links: CommentLink[] = rows.map((r) => {
    const systemUrl = new URL(`/p/${r.projectSlug}/systems/${r.systemSlug}`, site);
    if (r.taskId === null) {
      return { ref: `roadmap:${r.systemSlug}`, title: r.systemTitle, systemTitle: null, url: systemUrl.toString(), closes: r.closes, done: false };
    }
    systemUrl.hash = `task-${r.taskId}`;
    return { ref: `roadmap#${r.taskId}`, title: r.taskTitle ?? "", systemTitle: r.systemTitle, url: systemUrl.toString(), closes: r.closes, done: r.taskState === "done" };
  });
  links.sort((a, b) => Number(a.systemTitle === null) - Number(b.systemTitle === null) || a.ref.localeCompare(b.ref));
  const projectSlug = rows[0]?.projectSlug ?? (await deps.db.select({ slug: project.slug }).from(project).where(eq(project.id, repo.projectId)))[0]?.slug ?? "";
  const body = renderPrComment({ links, notice, pickUrl: pickUrlOf(projectSlug, repo.id, number) });

  try {
    const existing = await api.findComment(repo.installationId, repo.fullName, number, COMMENT_MARKER);
    if (!existing) {
      if (links.length === 0 && !notice) return null;
      await api.createComment(repo.installationId, repo.fullName, number, body);
    } else if (existing.body !== body) {
      await api.updateComment(repo.installationId, repo.fullName, existing.id, body);
    }
    return null;
  } catch (error) {
    console.error(`github: syncing the comment on ${repo.fullName}#${number} failed`, error);
    const status = (error as { status?: unknown } | null)?.status;
    if (typeof status === "number") return `comment skipped: GitHub refused (${status})`;
    const message = error instanceof Error ? error.message : String(error);
    return `comment skipped: ${message.slice(0, MAX_ERROR)}`;
  }
}
