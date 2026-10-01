import { eq, inArray } from "drizzle-orm";
import { githubInstallation, githubRepo } from "@/db/schema";
import { adoptRepos } from "@/lib/ops/github-app";
import { onGitHubEvent } from "./events";

/** The parts of `payload.installation` the handlers read. */
interface InstallationPayload {
  id: number;
  account?: { login?: string; type?: string } | null;
  repository_selection?: string;
}

/** A repository in an `installation_repositories` payload. */
interface RepoPayload {
  id: number;
  full_name: string;
  private?: boolean;
}

/** The installation status each `installation` action leads to. */
const STATUS_OF: Record<string, "active" | "suspended" | "removed"> = {
  created: "active",
  unsuspend: "active",
  new_permissions_accepted: "active",
  suspend: "suspended",
  deleted: "removed",
};

const toRepos = (repos: RepoPayload[]) => repos.map((r) => ({ id: r.id, fullName: r.full_name, private: r.private }));

const selectionOf = (value: unknown): "all" | "selected" => (value === "all" ? "all" : "selected");

onGitHubEvent("installation", async (job, deps) => {
  const payload = job.payload as { action?: string; installation?: InstallationPayload; repositories?: RepoPayload[] };
  const status = STATUS_OF[payload.action ?? ""];
  const installation = payload.installation;
  if (!status || !installation) return { status: "ignored", detail: `installation.${payload.action ?? "?"}` };
  // A payload without an account must not overwrite the stored one.
  const account = installation.account
    ? { accountLogin: installation.account.login ?? "", accountType: installation.account.type === "Organization" ? ("Organization" as const) : ("User" as const) }
    : null;
  const values = {
    repositorySelection: selectionOf(installation.repository_selection),
    status,
    updatedAt: deps.now(),
  };
  await deps.db.transaction(async (tx) => {
    await tx
      .insert(githubInstallation)
      .values({ id: installation.id, accountLogin: "", accountType: "User", ...account, ...values })
      .onConflictDoUpdate({ target: githubInstallation.id, set: { ...account, ...values } });
    if (status === "removed") await tx.update(githubRepo).set({ access: "lost" }).where(eq(githubRepo.installationId, installation.id));
    // A reinstall brings back the repos that were linked before it.
    if (status === "active" && payload.repositories) await adoptRepos(tx, installation.id, toRepos(payload.repositories));
  });
  await deps.kv.del(`gh:repos:${installation.id}`);
  return { status: "done" };
});

onGitHubEvent("installation_repositories", async (job, deps) => {
  const payload = job.payload as {
    installation?: InstallationPayload;
    repository_selection?: string;
    repositories_added?: RepoPayload[];
    repositories_removed?: RepoPayload[];
  };
  const installation = payload.installation;
  if (!installation) return { status: "ignored", detail: "no installation" };
  const added = payload.repositories_added ?? [];
  const removed = payload.repositories_removed ?? [];
  await deps.db.transaction(async (tx) => {
    // The count is cleared rather than adjusted, since a concurrent listing may already include these changes;
    // the next repo listing stores it again.
    await tx
      .update(githubInstallation)
      .set({
        repositorySelection: selectionOf(payload.repository_selection ?? installation.repository_selection),
        repoCount: null,
        updatedAt: deps.now(),
      })
      .where(eq(githubInstallation.id, installation.id));
    if (removed.length > 0) {
      await tx
        .update(githubRepo)
        .set({ access: "lost" })
        .where(inArray(githubRepo.githubRepoId, removed.map((r) => r.id)));
    }
    await adoptRepos(tx, installation.id, toRepos(added));
  });
  await deps.kv.del(`gh:repos:${installation.id}`);
  return { status: "done" };
});
