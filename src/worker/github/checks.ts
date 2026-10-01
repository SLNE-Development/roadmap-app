import { and, eq, inArray } from "drizzle-orm";
import { codeLink, project, system } from "@/db/schema";
import type { CheckSuiteInfo } from "@/lib/github/api";
import { logChange } from "@/lib/ops/log";
import { notify } from "@/lib/ops/notifications";
import { onGitHubEvent } from "./events";
import { findRepo, type RepositoryPayload } from "./pulls";
import { automationActor } from "./rules";

/** The parts of a `check_suite` payload the handler reads. */
interface CheckSuitePayload {
  action?: string;
  repository?: RepositoryPayload;
  check_suite?: { head_sha?: string };
}

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

/**
 * Rolls the check suites of a commit up into one result: `pending` while there are none or one still runs, else
 * `failure` when any ended badly, else `success` (neutral and skipped count as passing).
 */
export function aggregateChecks(suites: CheckSuiteInfo[]): "pending" | "success" | "failure" {
  if (suites.length === 0 || suites.some((s) => s.status !== "completed")) return "pending";
  return suites.some((s) => s.conclusion !== null && FAILED.has(s.conclusion)) ? "failure" : "success";
}

onGitHubEvent("check_suite", async (job, deps, api) => {
  const payload = job.payload as CheckSuitePayload;
  if (payload.action !== "completed") return { status: "ignored", detail: `check_suite.${payload.action ?? "?"}` };
  if (job.source === "repo") return { status: "ignored", detail: "manual webhook has no checks" };
  const repo = await findRepo(deps.db, job, payload.repository);
  if (!repo) return { status: "ignored", detail: "repository not linked" };
  const sha = payload.check_suite?.head_sha;
  if (repo.mode !== "app" || repo.installationId === null || !sha) return { status: "ignored", detail: "no checks to track" };
  const links = await deps.db
    .select()
    .from(codeLink)
    .where(and(eq(codeLink.repoId, repo.id), eq(codeLink.sha, sha)));
  if (links.length === 0) return { status: "ignored", detail: "no linked commit" };

  const checks = aggregateChecks(await api.listCheckSuites(repo.installationId, repo.fullName, sha));
  const actor = await automationActor(deps.db, repo, null);
  const changed = links.filter((l) => l.checks !== checks);
  await deps.db.transaction(async (tx) => {
    for (const link of changed) {
      await tx.update(codeLink).set({ checks, updatedAt: new Date() }).where(eq(codeLink.id, link.id));
      if (actor) {
        await logChange(tx, actor, {
          projectId: link.projectId,
          systemId: link.systemId,
          entity: "code",
          entityId: link.id,
          field: "checks",
          oldValue: link.checks,
          newValue: checks,
        });
      }
    }
    if (checks === "failure" && repo.rules.checksWarning && changed.length > 0) {
      const systems = await tx
        .select({ id: system.id, slug: system.slug, title: system.title, ownerUserId: system.ownerUserId })
        .from(system)
        .where(inArray(system.id, changed.map((l) => l.systemId)));
      const [{ slug: projectSlug }] = await tx.select({ slug: project.slug }).from(project).where(eq(project.id, repo.projectId));
      for (const s of systems) {
        if (!s.ownerUserId) continue;
        await notify(tx, {
          userId: s.ownerUserId,
          projectId: repo.projectId,
          kind: "checks.failed",
          entity: "system",
          entityId: s.id,
          title: `Checks failed on ${s.title}`,
          body: changed.find((l) => l.systemId === s.id)?.title,
          href: `/p/${projectSlug}/systems/${s.slug}`,
          sourceKey: `checks-failed:${repo.id}:${sha}`,
        });
      }
    }
  });
  return { status: "done", detail: `checks ${checks} on ${changed.length} of ${links.length} links` };
});
