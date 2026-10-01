import { randomBytes } from "node:crypto";
import { and, count, desc, eq, gt, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { githubApp, githubDelivery, githubInstallation, githubInstallRequest, githubRepo, user } from "@/db/schema";
import type { Db } from "@/db/types";
import { safeNextPath } from "@/lib/auth/next-path";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { GitHubApi } from "@/lib/github/api";
import { buildManifest } from "@/lib/github/manifest";
import { installationManageUrl, installUrl, manifestActionUrl } from "@/lib/github/urls";
import { newId } from "@/lib/id";
import type { Kv } from "@/lib/kv";
import { siteUrl } from "@/lib/site";
import type { Actor } from "./actor";
import { ConflictError, ForbiddenError, InvalidError, NotFoundError } from "./errors";
import { loadActor } from "./users";

/** Input of {@link saveAppCredentials}: what GitHub shows after the App is registered. */
export const appCredentialsInput = z.object({
  appId: z.number().int().positive(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "invalid slug"),
  name: z.string().trim().min(1),
  ownerLogin: z.string().trim().min(1),
  htmlUrl: z.string().trim().min(1).startsWith("https://github.com/", "must start with https://github.com/"),
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().trim().min(1).max(200),
  privateKey: z
    .string()
    .refine((v) => v.includes("-----BEGIN") && v.includes("PRIVATE KEY-----"), "must be a PEM private key"),
  webhookSecret: z.string().trim().min(1).max(200),
});

/** The GitHub App with its secrets decrypted; for server code only. */
export interface GitHubAppConfig {
  appId: number;
  slug: string;
  name: string;
  ownerLogin: string;
  htmlUrl: string;
  clientId: string;
  clientSecret: string;
  privateKey: string;
  webhookSecret: string;
  previousWebhookSecret: string | null;
  previousSecretExpiresAt: Date | null;
  linkPolicy: "owners" | "admins";
}

/** The GitHub App as admins see it: everything except the secrets. */
export interface AppSummary {
  appId: number;
  slug: string;
  name: string;
  ownerLogin: string;
  htmlUrl: string;
  linkPolicy: "owners" | "admins";
  createdAt: Date;
  createdByName: string | null;
  /** When the webhook secret was last rotated, or null when it never was. */
  secretRotatedAt: Date | null;
}

/** How long the webhook secret before a rotation stays accepted. */
const ROTATION_GRACE_MS = 10 * 60_000;

/** How long a manifest or install state is valid, in seconds. */
const STATE_TTL = 3600;

/** How long an installation's repository list stays in Kv, in seconds. */
const REPO_CACHE_TTL = 300;

/** Where installs return to when no safe path was given. */
const ADMIN_PATH = "/admin/github";

/** Throws unless the actor is an admin. */
function requireAdmin(actor: Actor, message = "Only admins can manage the GitHub App."): void {
  if (!actor.isAdmin) throw new ForbiddenError(message);
}

/** Returns a new random state for a GitHub redirect: 32 bytes as hex. */
function newState(): string {
  return randomBytes(32).toString("hex");
}

/** Returns `raw` when it is a safe same-origin path, else the admin page. */
function safeReturnTo(raw: string | null | undefined): string {
  const path = safeNextPath(raw);
  return path === "/" ? ADMIN_PATH : path;
}

/**
 * Stores the App's credentials, encrypting the secrets. Replaces the existing row but keeps its link policy.
 * Not written to `change_log`, which is per project.
 *
 * @throws ForbiddenError unless the actor is an admin
 * @throws InvalidError when the input does not match
 */
export async function saveAppCredentials(db: Db, actor: Actor, raw: z.input<typeof appCredentialsInput>): Promise<void> {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can configure the GitHub App.");
  const parsed = appCredentialsInput.safeParse(raw);
  if (!parsed.success) {
    throw new InvalidError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const c = parsed.data;
  const values = {
    appId: c.appId,
    slug: c.slug,
    name: c.name,
    ownerLogin: c.ownerLogin,
    htmlUrl: c.htmlUrl,
    clientId: c.clientId,
    clientSecretEnc: encryptSecret(c.clientSecret),
    privateKeyEnc: encryptSecret(c.privateKey),
    webhookSecretEnc: encryptSecret(c.webhookSecret),
    updatedAt: new Date(),
  };
  await db
    .insert(githubApp)
    .values({ id: "default", ...values, createdBy: actor.userId })
    .onConflictDoUpdate({ target: githubApp.id, set: values });
  console.info("github app configured", c.appId);
}

/** Returns the App with its secrets decrypted, or null when none is configured. */
export async function loadAppConfig(db: Db): Promise<GitHubAppConfig | null> {
  const [row] = await db.select().from(githubApp).where(eq(githubApp.id, "default"));
  if (!row) return null;
  return {
    appId: row.appId,
    slug: row.slug,
    name: row.name,
    ownerLogin: row.ownerLogin,
    htmlUrl: row.htmlUrl,
    clientId: row.clientId,
    clientSecret: decryptSecret(row.clientSecretEnc),
    privateKey: decryptSecret(row.privateKeyEnc),
    webhookSecret: decryptSecret(row.webhookSecretEnc),
    previousWebhookSecret: row.previousWebhookSecretEnc ? decryptSecret(row.previousWebhookSecretEnc) : null,
    previousSecretExpiresAt: row.previousSecretExpiresAt,
    linkPolicy: row.linkPolicy,
  };
}

/**
 * Returns the App without its secrets, or null when none is configured.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function getAppSummary(db: Db, actor: Actor): Promise<AppSummary | null> {
  if (!actor.isAdmin) throw new ForbiddenError("Only admins can view the GitHub App.");
  const [row] = await db
    .select({
      appId: githubApp.appId,
      slug: githubApp.slug,
      name: githubApp.name,
      ownerLogin: githubApp.ownerLogin,
      htmlUrl: githubApp.htmlUrl,
      linkPolicy: githubApp.linkPolicy,
      createdAt: githubApp.createdAt,
      createdByName: user.name,
      previousSecretExpiresAt: githubApp.previousSecretExpiresAt,
    })
    .from(githubApp)
    .leftJoin(user, eq(user.id, githubApp.createdBy))
    .where(eq(githubApp.id, "default"));
  if (!row) return null;
  const { previousSecretExpiresAt, ...summary } = row;
  return { ...summary, secretRotatedAt: previousSecretExpiresAt && new Date(previousSecretExpiresAt.getTime() - ROTATION_GRACE_MS) };
}

/** Input of {@link startManifest}: the organization to create the App under (none for the admin's account) and its name. */
export const startManifestInput = z.object({
  org: z.string().trim().nullish(),
  name: z.string().max(200).optional(),
});

/**
 * Starts the App manifest flow: returns where to post the manifest, the manifest as JSON, and the state GitHub
 * hands back to {@link completeManifest}.
 *
 * @throws ForbiddenError unless the actor is an admin
 * @throws InvalidError when the organization is not a valid login
 */
export async function startManifest(
  db: Db,
  kv: Kv,
  actor: Actor,
  raw: z.input<typeof startManifestInput>,
): Promise<{ action: string; manifest: string; state: string }> {
  requireAdmin(actor, "Only admins can create the GitHub App.");
  const { org, name } = startManifestInput.parse(raw);
  const state = newState();
  const action = manifestActionUrl(org || null, state);
  await kv.set(`gh:manifest:${state}`, actor.userId, STATE_TTL);
  return { action, manifest: JSON.stringify(buildManifest(siteUrl(), name ?? "")), state };
}

/**
 * Finishes the manifest flow: exchanges GitHub's code for the new App's credentials and stores them. The state
 * is used once.
 *
 * @throws ForbiddenError when the state is unknown, belongs to someone else, or the user is no longer an admin
 */
export async function completeManifest(db: Db, kv: Kv, api: GitHubApi, userId: string, code: string, state: string): Promise<void> {
  const key = `gh:manifest:${state}`;
  if (!state || (await kv.get(key)) !== userId) throw new ForbiddenError("This GitHub App setup link has expired. Start again.");
  const actor = await loadActor(db, userId);
  if (!actor?.isAdmin) throw new ForbiddenError("Only admins can create the GitHub App.");
  await kv.del(key);
  const app = await api.convertManifest(code);
  await saveAppCredentials(db, actor, {
    appId: app.id,
    slug: app.slug,
    name: app.name,
    ownerLogin: app.ownerLogin,
    htmlUrl: app.htmlUrl,
    clientId: app.clientId,
    clientSecret: app.clientSecret,
    privateKey: app.pem,
    webhookSecret: app.webhookSecret,
  });
}

/**
 * Starts installing the App on a GitHub account; the setup route sends the user back to `returnTo` afterwards.
 *
 * @param raw.returnTo a same-origin path; anything else returns to the admin page
 * @throws ConflictError when no App is set up
 */
export async function startInstall(db: Db, kv: Kv, actor: Actor, raw: { returnTo?: string }): Promise<{ url: string }> {
  const [app] = await db.select({ slug: githubApp.slug }).from(githubApp).where(eq(githubApp.id, "default"));
  if (!app) throw new ConflictError("The GitHub App is not set up yet.");
  const state = newState();
  await kv.set(`gh:install:${state}`, JSON.stringify({ userId: actor.userId, returnTo: safeReturnTo(raw.returnTo) }), STATE_TTL);
  return { url: installUrl(app.slug, state) };
}

/** Reads the return path of an install state, or the admin page when the state is missing, unknown or another user's. */
async function installReturnTo(kv: Kv, userId: string, state: string | null): Promise<string> {
  if (!state) return ADMIN_PATH;
  const key = `gh:install:${state}`;
  const raw = await kv.get(key);
  if (!raw) return ADMIN_PATH;
  await kv.del(key);
  try {
    const parsed = JSON.parse(raw) as { userId?: unknown; returnTo?: unknown };
    return parsed.userId === userId && typeof parsed.returnTo === "string" ? safeReturnTo(parsed.returnTo) : ADMIN_PATH;
  } catch {
    return ADMIN_PATH;
  }
}

/** Records an install request of the user, unless they already have an undismissed one from the last 24 hours. */
async function requestInstall(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Locks the user's row so two redirects at once cannot both insert.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("no key update");
    const since = new Date(Date.now() - 86_400_000);
    const [open] = await tx
      .select({ id: githubInstallRequest.id })
      .from(githubInstallRequest)
      .where(
        and(eq(githubInstallRequest.requestedByUserId, userId), isNull(githubInstallRequest.dismissedAt), gt(githubInstallRequest.requestedAt, since)),
      )
      .limit(1);
    if (!open) await tx.insert(githubInstallRequest).values({ id: newId(), requestedByUserId: userId });
  });
}

/**
 * Handles GitHub's redirect after an install, update or install request. Never trusts the query: the
 * installation is read from GitHub and stored from its data, keeping the first installer; its repository list
 * refreshes the count and the Kv cache.
 *
 * @returns the path to redirect to
 */
export async function recordInstallation(
  db: Db,
  kv: Kv,
  api: GitHubApi,
  userId: string,
  raw: { installationId: number | null; setupAction: string | null; state: string | null },
): Promise<string> {
  const returnTo = await installReturnTo(kv, userId, raw.state);
  if (raw.installationId !== null) {
    const info = await api.getInstallation(raw.installationId);
    if (!info) return `${ADMIN_PATH}?error=installation`;
    const repos = await api.listInstallationRepos(info.id).catch((error: unknown) => {
      console.error("github installation repos could not be listed", info.id, error);
      return null;
    });
    const values = {
      accountLogin: info.accountLogin,
      accountType: info.accountType,
      repositorySelection: info.repositorySelection,
      status: info.suspended ? ("suspended" as const) : ("active" as const),
      // Without the list the stored count stays as it was.
      ...(repos && { repoCount: repos.length }),
      updatedAt: new Date(),
    };
    await db
      .insert(githubInstallation)
      .values({ id: info.id, ...values, installedByUserId: userId })
      .onConflictDoUpdate({ target: githubInstallation.id, set: values });
    if (repos) await kv.set(`gh:repos:${info.id}`, JSON.stringify(repos), REPO_CACHE_TTL);
    else await kv.del(`gh:repos:${info.id}`);
    return returnTo;
  }
  if (raw.setupAction === "request") {
    await requestInstall(db, userId);
    return `${returnTo}${returnTo.includes("?") ? "&" : "?"}requested=1`;
  }
  return returnTo;
}

/** An installation as the admin page lists it. */
export interface InstallationView {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  repositorySelection: "all" | "selected";
  repoCount: number | null;
  status: "active" | "suspended" | "removed";
  installedByName: string | null;
  manageUrl: string;
  linkedRepoCount: number;
}

/**
 * Lists the App's installations, active first, then by account login.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function listInstallations(db: Db, actor: Actor): Promise<InstallationView[]> {
  requireAdmin(actor);
  const rows = await db
    .select({
      id: githubInstallation.id,
      accountLogin: githubInstallation.accountLogin,
      accountType: githubInstallation.accountType,
      repositorySelection: githubInstallation.repositorySelection,
      repoCount: githubInstallation.repoCount,
      status: githubInstallation.status,
      installedByName: user.name,
    })
    .from(githubInstallation)
    .leftJoin(user, eq(user.id, githubInstallation.installedByUserId));
  const ids = rows.map((r) => r.id);
  const linked = ids.length
    ? await db
        .select({ id: githubRepo.installationId, n: count() })
        .from(githubRepo)
        .where(inArray(githubRepo.installationId, ids))
        .groupBy(githubRepo.installationId)
    : [];
  const linkedOf = new Map(linked.map((l) => [l.id, l.n]));
  return rows
    .map((r) => ({ ...r, manageUrl: installationManageUrl(r), linkedRepoCount: linkedOf.get(r.id) ?? 0 }))
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || a.accountLogin.localeCompare(b.accountLogin));
}

/** An install waiting for an organization owner's approval. */
export interface InstallRequestView {
  id: string;
  requestedByName: string;
  requestedAt: Date;
}

/**
 * Lists the install requests of the last 30 days that no admin dismissed, newest first.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function listInstallRequests(db: Db, actor: Actor): Promise<InstallRequestView[]> {
  requireAdmin(actor);
  const since = new Date(Date.now() - 30 * 86_400_000);
  return db
    .select({ id: githubInstallRequest.id, requestedByName: user.name, requestedAt: githubInstallRequest.requestedAt })
    .from(githubInstallRequest)
    .innerJoin(user, eq(user.id, githubInstallRequest.requestedByUserId))
    .where(and(isNull(githubInstallRequest.dismissedAt), gt(githubInstallRequest.requestedAt, since)))
    .orderBy(desc(githubInstallRequest.requestedAt));
}

/**
 * Dismisses an install request.
 *
 * @throws ForbiddenError unless the actor is an admin
 * @throws NotFoundError when no open request has the id
 */
export async function dismissInstallRequest(db: Db, actor: Actor, id: string): Promise<void> {
  requireAdmin(actor);
  const done = await db
    .update(githubInstallRequest)
    .set({ dismissedAt: new Date() })
    .where(and(eq(githubInstallRequest.id, id), isNull(githubInstallRequest.dismissedAt)))
    .returning({ id: githubInstallRequest.id });
  if (done.length === 0) throw new NotFoundError("This install request is gone.");
}

/** How the App's webhook deliveries are doing. */
export interface AppHealth {
  lastWebhookAt: Date | null;
  failedLast24h: number;
  recentErrors: { deliveryId: string; event: string; detail: string | null; receivedAt: Date }[];
}

/**
 * Reports the App's webhook health from its own deliveries and the deliveries GitHub could not deliver.
 *
 * @throws ForbiddenError unless the actor is an admin
 */
export async function appHealth(db: Db, api: GitHubApi, actor: Actor, now: Date): Promise<AppHealth> {
  requireAdmin(actor);
  const since = new Date(now.getTime() - 86_400_000);
  const fromApp = eq(githubDelivery.source, "app");
  const failed = and(fromApp, eq(githubDelivery.status, "failed"));
  const [[last], [ours], recentErrors, theirs] = await Promise.all([
    db.select({ at: max(githubDelivery.receivedAt) }).from(githubDelivery).where(fromApp),
    db.select({ n: count() }).from(githubDelivery).where(and(failed, gt(githubDelivery.receivedAt, since))),
    db
      .select({ deliveryId: githubDelivery.deliveryId, event: githubDelivery.event, detail: githubDelivery.detail, receivedAt: githubDelivery.receivedAt })
      .from(githubDelivery)
      .where(failed)
      .orderBy(desc(githubDelivery.receivedAt))
      .limit(5),
    api.listFailedDeliveries(since),
  ]);
  return { lastWebhookAt: last?.at ?? null, failedLast24h: ours.n + theirs.length, recentErrors };
}

/**
 * Replaces the webhook secret. GitHub is told first, so a failed call stores nothing; the old secret stays
 * accepted for 10 minutes for deliveries already signed with it.
 *
 * @throws ForbiddenError unless the actor is an admin
 * @throws ConflictError when no App is set up
 */
export async function rotateWebhookSecret(db: Db, api: GitHubApi, actor: Actor, now: Date): Promise<void> {
  requireAdmin(actor);
  const config = await loadAppConfig(db);
  if (!config) throw new ConflictError("The GitHub App is not set up yet.");
  const secret = randomBytes(32).toString("hex");
  await api.updateWebhookSecret(secret);
  await db
    .update(githubApp)
    .set({
      webhookSecretEnc: encryptSecret(secret),
      previousWebhookSecretEnc: encryptSecret(config.webhookSecret),
      previousSecretExpiresAt: new Date(now.getTime() + ROTATION_GRACE_MS),
      updatedAt: now,
    })
    .where(eq(githubApp.id, "default"));
  console.info("github webhook secret rotated");
}

/** Input of {@link setLinkPolicy}. */
export const linkPolicyInput = z.enum(["owners", "admins"]);

/**
 * Sets who may link repositories to projects: project owners, or admins only.
 *
 * @throws ForbiddenError unless the actor is an admin
 * @throws ConflictError when no App is set up
 */
export async function setLinkPolicy(db: Db, actor: Actor, policy: z.input<typeof linkPolicyInput>): Promise<void> {
  requireAdmin(actor);
  const linkPolicy = linkPolicyInput.parse(policy);
  const done = await db
    .update(githubApp)
    .set({ linkPolicy, updatedAt: new Date() })
    .where(eq(githubApp.id, "default"))
    .returning({ id: githubApp.id });
  if (done.length === 0) throw new ConflictError("The GitHub App is not set up yet.");
}
