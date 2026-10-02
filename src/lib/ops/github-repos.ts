import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { githubApp, githubInstallation, githubRepo, user, type RepoRules } from "@/db/schema";
import type { Db, Executor } from "@/db/types";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { GitHubApi, RepoInfo } from "@/lib/github/api";
import { repoFullNameSchema } from "@/lib/github/repo-name";
import { newId } from "@/lib/id";
import type { Kv } from "@/lib/kv";
import { siteUrl } from "@/lib/site";
import { projectAccess, projectAccessById, type ProjectAccess } from "./access";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, InvalidError, isUniqueViolation, NotFoundError } from "./errors";
import { REPO_CACHE_TTL, startInstall } from "./github-app";
import { logChange } from "./log";

export { repoFullNameSchema };

/** Input of {@link linkAppRepo} and {@link linkManualRepo}. */
export const linkRepoInput = z.object({ fullName: repoFullNameSchema });

/** Input of {@link setRepoRules}; omitted rules stay unchanged. */
export const repoRulesInput = z.object({
  closeOnMerge: z.boolean().optional(),
  reviewOnOpen: z.boolean().optional(),
  checksWarning: z.boolean().optional(),
});

/** A repository the App can see, and whether it is linked here, elsewhere or not at all. */
export interface AvailableRepo {
  fullName: string;
  ownerLogin: string;
  private: boolean;
  installationId: number;
  githubRepoId: number;
  /** `projectName` is null when the actor cannot see the other project. */
  linked: null | { here: true } | { here: false; projectName: string | null };
}

/** A repository linked to the project, as its settings list it. */
export interface LinkedRepoView {
  id: string;
  fullName: string;
  mode: "app" | "webhook";
  access: "ok" | "lost";
  private: boolean | null;
  rules: RepoRules;
  lastEventAt: Date | null;
  createdByName: string | null;
}

/** The manual webhook of a repository: where GitHub posts and the secret it signs with. */
export interface RepoWebhook {
  webhookUrl: string;
  secret: string;
}

const ADMINS_ONLY = "Only admins can link repositories on this instance.";
const APP_SEES_IT = "The GitHub App can see this repository; linking it through the app also shows checks.";

/** Columns of a {@link LinkedRepoView}; select from `githubRepo` left-joined with its creator. */
const linkedColumns = {
  id: githubRepo.id,
  fullName: githubRepo.fullName,
  mode: githubRepo.mode,
  access: githubRepo.access,
  private: githubRepo.private,
  rules: githubRepo.rules,
  lastEventAt: githubRepo.lastEventAt,
  createdByName: user.name,
};

/**
 * Parses `raw` with `schema`, turning a failure into an InvalidError with the issue messages.
 *
 * @throws InvalidError when the input does not match
 */
function parse<T extends z.ZodType>(schema: T, raw: unknown): z.output<T> {
  const result = schema.safeParse(raw);
  if (!result.success) throw new InvalidError(result.error.issues.map((i) => i.message).join(" "));
  return result.data;
}

/** The manual webhook URL of a repository. */
function webhookUrlOf(repoId: string): string {
  return new URL(`/api/github/hooks/${repoId}`, siteUrl()).toString();
}

/**
 * Checks that the actor may link repositories in the project: an admin, or an owner while the link policy is
 * `owners`. Without an App the policy is `owners`, so repositories can still be linked by hand.
 *
 * @throws NotFoundError if the actor cannot see the project
 * @throws ForbiddenError if the actor may not link there
 * @throws ConflictError if the project is archived
 */
async function linkerAccess(db: Executor, actor: Actor, ref: { slug: string } | { id: string }): Promise<ProjectAccess> {
  const access = (need: "viewer" | "owner") =>
    "slug" in ref ? projectAccess(db, actor, ref.slug, need) : projectAccessById(db, actor, ref.id, need);
  await access("viewer");
  if (!actor.isAdmin) {
    const [app] = await db.select({ linkPolicy: githubApp.linkPolicy }).from(githubApp).where(eq(githubApp.id, "default"));
    if (app?.linkPolicy === "admins") throw new ForbiddenError(ADMINS_ONLY);
  }
  try {
    return await access("owner");
  } catch (error) {
    if (error instanceof ForbiddenError) throw new ForbiddenError(ADMINS_ONLY);
    throw error;
  }
}

/**
 * Loads a linked repository the actor can see.
 *
 * @throws NotFoundError if it does not exist or lies in a project the actor cannot see
 */
async function findRepo(db: Executor, actor: Actor, repoId: string) {
  const [row] = await db.select().from(githubRepo).where(eq(githubRepo.id, repoId));
  if (!row) throw new NotFoundError("Unknown repository.");
  try {
    await projectAccessById(db, actor, row.projectId, "viewer");
  } catch (error) {
    if (error instanceof NotFoundError) throw new NotFoundError("Unknown repository.");
    throw error;
  }
  return row;
}

/** Loads one repository as a {@link LinkedRepoView}. */
async function linkedView(db: Executor, repoId: string): Promise<LinkedRepoView> {
  const [row] = await db.select(linkedColumns).from(githubRepo).leftJoin(user, eq(user.id, githubRepo.createdBy)).where(eq(githubRepo.id, repoId));
  return row;
}

/** Whether an App is configured. */
async function hasApp(db: Executor): Promise<boolean> {
  const [app] = await db.select({ id: githubApp.id }).from(githubApp).where(eq(githubApp.id, "default"));
  return Boolean(app);
}

/** The ids of the active installations. */
async function activeInstallations(db: Executor): Promise<number[]> {
  const rows = await db.select({ id: githubInstallation.id }).from(githubInstallation).where(eq(githubInstallation.status, "active"));
  return rows.map((r) => r.id);
}

/** The cached repository list of an installation, or null on a miss or when Kv is unavailable. */
async function cachedRepos(kv: Kv, installationId: number): Promise<RepoInfo[] | null> {
  try {
    const raw = await kv.get(`gh:repos:${installationId}`);
    return raw ? (JSON.parse(raw) as RepoInfo[]) : null;
  } catch (error) {
    console.error("github repo cache could not be read", installationId, error);
    return null;
  }
}

/**
 * Returns an installation's repositories from the Kv cache or, on a miss or with `fresh`, from GitHub; a list from
 * GitHub is cached and stored as the installation's repo count.
 */
async function installationRepos(db: Db, kv: Kv, api: GitHubApi, installationId: number, fresh = false): Promise<RepoInfo[]> {
  const cached = fresh ? null : await cachedRepos(kv, installationId);
  if (cached) return cached;
  const repos = await api.listInstallationRepos(installationId);
  await db.update(githubInstallation).set({ repoCount: repos.length }).where(eq(githubInstallation.id, installationId));
  try {
    await kv.set(`gh:repos:${installationId}`, JSON.stringify(repos), REPO_CACHE_TTL);
  } catch (error) {
    console.error("github repo cache could not be written", installationId, error);
  }
  return repos;
}

/** Like {@link installationRepos}, but one installation GitHub cannot list is logged and skipped (null). */
async function installationReposOrNull(db: Db, kv: Kv, api: GitHubApi, installationId: number, fresh = false): Promise<RepoInfo[] | null> {
  try {
    return await installationRepos(db, kv, api, installationId, fresh);
  } catch (error) {
    console.error("github installation repositories could not be listed", installationId, error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

/**
 * Finds `fullName` among the active installations' repositories, asking GitHub again when the cache misses it. An
 * installation that cannot be listed is skipped.
 */
async function findAppRepo(db: Db, kv: Kv, api: GitHubApi, fullName: string): Promise<{ repo: RepoInfo; installationId: number } | null> {
  const key = fullName.toLowerCase();
  const installations = await activeInstallations(db);
  const cachedIds: number[] = [];
  for (const installationId of installations) {
    const cached = await cachedRepos(kv, installationId);
    if (cached) cachedIds.push(installationId);
    const repos = cached ?? (await installationReposOrNull(db, kv, api, installationId, true));
    const repo = repos?.find((r) => r.fullName.toLowerCase() === key);
    if (repo) return { repo, installationId };
  }
  // Lists just fetched from GitHub are already fresh; only the cached ones may be stale.
  for (const installationId of cachedIds) {
    const repo = (await installationReposOrNull(db, kv, api, installationId, true))?.find((r) => r.fullName.toLowerCase() === key);
    if (repo) return { repo, installationId };
  }
  return null;
}

/**
 * Inserts a linked repository and logs it in one transaction.
 *
 * @throws ConflictError when the repository is already linked, naming only the repository
 */
async function insertRepo(db: Db, actor: Actor, values: typeof githubRepo.$inferInsert): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(githubRepo).values(values);
      await logChange(tx, actor, { projectId: values.projectId, entity: "repo", entityId: values.id, field: "created", newValue: values.fullName });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError(`${values.fullName} is already linked to another project.`);
    throw error;
  }
}

/**
 * The repositories the App's active installations can see, sorted by owner then name, with where each is linked.
 * With a `projectId`, a repository linked there is `here`; with null none is. A repository linked to a project the
 * actor cannot see shows no project name. Without an App the list is empty; an installation GitHub cannot list is
 * left out.
 */
async function appRepos(db: Db, kv: Kv, api: GitHubApi, actor: Actor, projectId: string | null): Promise<AvailableRepo[]> {
  if (!(await hasApp(db))) return [];
  const lists = await Promise.all(
    (await activeInstallations(db)).map(async (installationId) =>
      ((await installationReposOrNull(db, kv, api, installationId)) ?? []).map((repo) => ({ repo, installationId })),
    ),
  );
  const found = lists.flat();
  if (found.length === 0) return [];
  const links = await db
    .select({ projectId: githubRepo.projectId, fullNameKey: githubRepo.fullNameKey })
    .from(githubRepo)
    .where(inArray(githubRepo.fullNameKey, found.map((f) => f.repo.fullName.toLowerCase())));
  const projectOf = new Map(links.map((l) => [l.fullNameKey, l.projectId]));
  const names = new Map<string, string | null>();
  for (const linkedId of new Set(links.map((l) => l.projectId))) {
    if (linkedId === projectId) continue;
    try {
      names.set(linkedId, (await projectAccessById(db, actor, linkedId, "viewer")).project.name);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
      names.set(linkedId, null);
    }
  }
  return found
    .map(({ repo, installationId }): AvailableRepo => {
      const linkedTo = projectOf.get(repo.fullName.toLowerCase());
      return {
        fullName: repo.fullName,
        ownerLogin: repo.ownerLogin,
        private: repo.private,
        installationId,
        githubRepoId: repo.id,
        linked: linkedTo === undefined ? null : linkedTo === projectId ? { here: true } : { here: false, projectName: names.get(linkedTo) ?? null },
      };
    })
    .sort((a, b) => a.ownerLogin.localeCompare(b.ownerLogin) || a.fullName.localeCompare(b.fullName));
}

/**
 * Lists the repositories the App's active installations can see, sorted by owner then name, and where each is
 * linked. A repository linked to a project the actor cannot see shows no project name. Without an App the list is
 * empty; an installation GitHub cannot list is left out. Same permission as linking.
 *
 * @throws NotFoundError if the actor cannot see the project
 * @throws ForbiddenError if the actor may not link there
 */
export async function availableRepos(db: Db, kv: Kv, api: GitHubApi, actor: Actor, projectSlug: string): Promise<AvailableRepo[]> {
  const { project } = await linkerAccess(db, actor, { slug: projectSlug });
  return appRepos(db, kv, api, actor, project.id);
}

/** The repositories a project form can offer, and whether the actor may link one. */
export interface PickableRepos {
  canLink: boolean;
  repos: AvailableRepo[];
}

/**
 * Lists the repositories the App can see for project forms; without a project none is `linked.here`. `canLink` is true
 * when an App is set up and the actor is an admin or the link policy is not `admins`; otherwise `repos` is empty.
 * With `projectSlug`, that project's own repositories are `linked.here`; this needs viewer access only.
 *
 * @throws NotFoundError if `projectSlug` is given and the actor cannot see the project
 */
export async function pickableRepos(db: Db, kv: Kv, api: GitHubApi, actor: Actor, projectSlug?: string): Promise<PickableRepos> {
  const projectId = projectSlug ? (await projectAccess(db, actor, projectSlug, "viewer")).project.id : null;
  const [app] = await db.select({ linkPolicy: githubApp.linkPolicy }).from(githubApp).where(eq(githubApp.id, "default"));
  if (!app || (!actor.isAdmin && app.linkPolicy === "admins")) return { canLink: false, repos: [] };
  return { canLink: true, repos: await appRepos(db, kv, api, actor, projectId) };
}

/** Lists the project's linked repositories by name. Viewer or higher. */
export async function listLinkedRepos(db: Executor, actor: Actor, projectSlug: string): Promise<LinkedRepoView[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  return db
    .select(linkedColumns)
    .from(githubRepo)
    .leftJoin(user, eq(user.id, githubRepo.createdBy))
    .where(eq(githubRepo.projectId, project.id))
    .orderBy(asc(githubRepo.fullNameKey));
}

/** What the GitHub settings page needs to know before it shows the picker. */
export interface RepoLinkStatus {
  appConfigured: boolean;
  canLink: boolean;
  isAdmin: boolean;
}

/** Tells whether an App is set up and whether the actor may link repositories in the project. Viewer or higher. */
export async function repoLinkStatus(db: Executor, actor: Actor, projectSlug: string): Promise<RepoLinkStatus> {
  await projectAccess(db, actor, projectSlug, "viewer");
  const canLink = await linkerAccess(db, actor, { slug: projectSlug }).then(
    () => true,
    (error: unknown) => {
      if (error instanceof ForbiddenError || error instanceof ConflictError) return false;
      throw error;
    },
  );
  return { appConfigured: await hasApp(db), canLink, isAdmin: actor.isAdmin };
}

/**
 * Links a repository the App can see to the project and logs it.
 *
 * @throws InvalidError for a malformed name or a repository the App cannot see
 * @throws ConflictError when the repository is already linked
 * @throws ForbiddenError if the actor may not link there
 */
export async function linkAppRepo(
  db: Db,
  kv: Kv,
  api: GitHubApi,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof linkRepoInput>,
): Promise<LinkedRepoView> {
  const { fullName } = parse(linkRepoInput, raw);
  const { project } = await linkerAccess(db, actor, { slug: projectSlug });
  const found = await findAppRepo(db, kv, api, fullName);
  if (!found) throw new InvalidError(`The GitHub App can't see ${fullName}. Install it on that repository first, or add it by hand.`);
  const id = newId();
  await insertRepo(db, actor, {
    id,
    projectId: project.id,
    fullName: found.repo.fullName,
    fullNameKey: found.repo.fullName.toLowerCase(),
    githubRepoId: found.repo.id,
    installationId: found.installationId,
    mode: "app",
    private: found.repo.private,
    createdBy: actor.userId,
  });
  return linkedView(db, id);
}

/**
 * Links a repository by hand through its own webhook: generates a secret, stores it encrypted, and returns it with
 * the payload URL once. With `kv`, a repository an installation's cached list already contains gets a hint that
 * linking it through the App also shows checks; GitHub is not asked.
 *
 * @throws InvalidError for a malformed name
 * @throws ConflictError when the repository is already linked
 * @throws ForbiddenError if the actor may not link there
 */
export async function linkManualRepo(
  db: Db,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof linkRepoInput>,
  kv?: Kv,
): Promise<{ repo: LinkedRepoView; webhookUrl: string; secret: string; hint?: string }> {
  const { fullName } = parse(linkRepoInput, raw);
  const { project } = await linkerAccess(db, actor, { slug: projectSlug });
  const id = newId();
  const secret = randomBytes(32).toString("hex");
  await insertRepo(db, actor, {
    id,
    projectId: project.id,
    fullName,
    fullNameKey: fullName.toLowerCase(),
    mode: "webhook",
    webhookSecretEnc: encryptSecret(secret),
    createdBy: actor.userId,
  });
  let hint: string | undefined;
  if (kv) {
    for (const installationId of await activeInstallations(db)) {
      const repos = await cachedRepos(kv, installationId);
      if (repos?.some((r) => r.fullName.toLowerCase() === fullName.toLowerCase())) hint = APP_SEES_IT;
    }
  }
  return { repo: await linkedView(db, id), webhookUrl: webhookUrlOf(id), secret, ...(hint && { hint }) };
}

/**
 * Returns a webhook repository's payload URL and secret again. Same permission as linking; the secret is never
 * logged.
 *
 * @throws NotFoundError if the repository does not exist or lies in a project the actor cannot see
 * @throws InvalidError if the repository is linked through the App
 * @throws ForbiddenError if the actor may not link there
 */
export async function revealRepoSecret(db: Db, actor: Actor, repoId: string): Promise<RepoWebhook> {
  const repo = await findRepo(db, actor, repoId);
  await linkerAccess(db, actor, { id: repo.projectId });
  if (repo.mode !== "webhook" || !repo.webhookSecretEnc) {
    throw new InvalidError(`${repo.fullName} is linked through the GitHub App and has no webhook secret.`);
  }
  return { webhookUrl: webhookUrlOf(repo.id), secret: decryptSecret(repo.webhookSecretEnc) };
}

/**
 * Unlinks a repository; its code links go with it. Same permission as linking.
 *
 * @throws NotFoundError if the repository does not exist or lies in a project the actor cannot see
 * @throws ForbiddenError if the actor may not link there
 */
export async function unlinkRepo(db: Db, actor: Actor, repoId: string): Promise<void> {
  const repo = await findRepo(db, actor, repoId);
  await db.transaction(async (tx) => {
    await linkerAccess(tx, actor, { id: repo.projectId });
    await tx.delete(githubRepo).where(and(eq(githubRepo.id, repo.id), eq(githubRepo.projectId, repo.projectId)));
    await logChange(tx, actor, { projectId: repo.projectId, entity: "repo", entityId: repo.id, field: "deleted", oldValue: repo.fullName });
  });
}

/**
 * Changes a repository's automation rules, keeping the ones not given, and logs the old and new rules. Owner or
 * higher.
 *
 * @throws NotFoundError if the repository does not exist or lies in a project the actor cannot see
 * @throws ForbiddenError below the owner role
 */
export async function setRepoRules(db: Db, actor: Actor, repoId: string, raw: z.input<typeof repoRulesInput>): Promise<void> {
  const patch = parse(repoRulesInput, raw);
  const repo = await findRepo(db, actor, repoId);
  await db.transaction(async (tx) => {
    await projectAccessById(tx, actor, repo.projectId, "owner");
    const [current] = await tx.select({ rules: githubRepo.rules }).from(githubRepo).where(eq(githubRepo.id, repo.id)).for("update");
    if (!current) throw new NotFoundError("Unknown repository.");
    // Rebuilt in a fixed key order, since jsonb reorders keys.
    const old: RepoRules = {
      closeOnMerge: current.rules.closeOnMerge,
      reviewOnOpen: current.rules.reviewOnOpen,
      checksWarning: current.rules.checksWarning,
    };
    const next: RepoRules = {
      closeOnMerge: patch.closeOnMerge ?? old.closeOnMerge,
      reviewOnOpen: patch.reviewOnOpen ?? old.reviewOnOpen,
      checksWarning: patch.checksWarning ?? old.checksWarning,
    };
    const [oldValue, newValue] = [JSON.stringify(old), JSON.stringify(next)];
    if (oldValue === newValue) return;
    await tx.update(githubRepo).set({ rules: next }).where(eq(githubRepo.id, repo.id));
    await logChange(tx, actor, { projectId: repo.projectId, entity: "repo", entityId: repo.id, field: "rules", oldValue, newValue });
  });
}

/**
 * Starts installing the App on more repositories, returning to the project's GitHub settings afterwards. Same
 * permission as linking.
 *
 * @throws ForbiddenError if the actor may not link there
 * @throws ConflictError when no App is set up
 */
export async function installMoreUrl(db: Db, kv: Kv, actor: Actor, projectSlug: string): Promise<{ url: string }> {
  const { project } = await linkerAccess(db, actor, { slug: projectSlug });
  return startInstall(db, kv, actor, { returnTo: `/p/${project.slug}/settings/github` });
}
