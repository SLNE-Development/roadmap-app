import { bigint, boolean, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { tz, user } from "./auth";
import { system, task } from "./content";
import { project } from "./projects";

/** The GitHub App of this instance: a single row with id `default`; the four secrets are stored encrypted. */
export const githubApp = pgTable("github_app", {
  id: text("id").primaryKey(),
  appId: integer("app_id").notNull(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  ownerLogin: text("owner_login").notNull(),
  htmlUrl: text("html_url").notNull(),
  clientId: text("client_id").notNull(),
  clientSecretEnc: text("client_secret_enc").notNull(),
  privateKeyEnc: text("private_key_enc").notNull(),
  webhookSecretEnc: text("webhook_secret_enc").notNull(),
  /** The webhook secret before the last rotation, still accepted until it expires. */
  previousWebhookSecretEnc: text("previous_webhook_secret_enc"),
  previousSecretExpiresAt: timestamp("previous_secret_expires_at", tz),
  /** Who may link repositories: project owners or only admins. */
  linkPolicy: text("link_policy", { enum: ["owners", "admins"] }).notNull().default("owners"),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** One GitHub installation of the app; the id is GitHub's installation id. */
export const githubInstallation = pgTable("github_installation", {
  id: bigint("id", { mode: "number" }).primaryKey(),
  accountLogin: text("account_login").notNull(),
  accountType: text("account_type", { enum: ["User", "Organization"] }).notNull(),
  repositorySelection: text("repository_selection", { enum: ["all", "selected"] }).notNull(),
  repoCount: integer("repo_count"),
  status: text("status", { enum: ["active", "suspended", "removed"] }).notNull().default("active"),
  installedByUserId: text("installed_by_user_id").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** An install waiting for an organisation owner's approval. */
export const githubInstallRequest = pgTable("github_install_request", {
  id: text("id").primaryKey(),
  requestedByUserId: text("requested_by_user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  requestedAt: timestamp("requested_at", tz).notNull().defaultNow(),
  dismissedAt: timestamp("dismissed_at", tz),
});

/** The automation rules of a linked repository. */
export interface RepoRules {
  closeOnMerge: boolean;
  reviewOnOpen: boolean;
  checksWarning: boolean;
}

/** A repository linked to a project. Its id is also the path segment of the manual webhook URL. */
export const githubRepo = pgTable("github_repo", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => project.id, { onDelete: "cascade" }),
  /** As GitHub spells it, such as `SLNE-Development/surf`. */
  fullName: text("full_name").notNull(),
  /** `fullName` lower-cased; one repository links to at most one project. */
  fullNameKey: text("full_name_key").notNull().unique(),
  /** Set in app mode only. */
  githubRepoId: bigint("github_repo_id", { mode: "number" }),
  installationId: bigint("installation_id", { mode: "number" }).references(() => githubInstallation.id, { onDelete: "set null" }),
  mode: text("mode", { enum: ["app", "webhook"] }).notNull(),
  access: text("access", { enum: ["ok", "lost"] }).notNull().default("ok"),
  private: boolean("private"),
  /** Webhook mode only. */
  webhookSecretEnc: text("webhook_secret_enc"),
  rules: jsonb("rules")
    .$type<RepoRules>()
    .notNull()
    .default({ closeOnMerge: false, reviewOnOpen: false, checksWarning: false }),
  lastEventAt: timestamp("last_event_at", tz),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

/** Every webhook delivery received, for dedupe and health. The id is `X-GitHub-Delivery`. */
export const githubDelivery = pgTable(
  "github_delivery",
  {
    deliveryId: text("delivery_id").primaryKey(),
    source: text("source", { enum: ["app", "repo"] }).notNull(),
    event: text("event").notNull(),
    repoId: text("repo_id").references(() => githubRepo.id, { onDelete: "set null" }),
    status: text("status", { enum: ["queued", "done", "ignored", "skipped", "failed"] }).notNull().default("queued"),
    detail: text("detail"),
    receivedAt: timestamp("received_at", tz).notNull().defaultNow(),
  },
  (t) => [index("github_delivery_received_idx").on(t.receivedAt)],
);

/** A pull request or commit linked to a task or system. */
export const codeLink = pgTable(
  "code_link",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    systemId: text("system_id")
      .notNull()
      .references(() => system.id, { onDelete: "cascade" }),
    taskId: integer("task_id").references(() => task.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepo.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["pr", "commit"] }).notNull(),
    /** `pr:<number>` or `commit:<sha>`. */
    refKey: text("ref_key").notNull(),
    /** `task:<id>` or `system:<systemId>`. */
    targetKey: text("target_key").notNull(),
    number: integer("number"),
    /** The commit sha, or the pull request's head sha. */
    sha: text("sha"),
    title: text("title").notNull(),
    url: text("url").notNull(),
    /** Pull requests only; commits use `merged`. */
    state: text("state", { enum: ["open", "closed", "merged"] }).notNull(),
    checks: text("checks", { enum: ["pending", "success", "failure"] }),
    /** The reference was in the pull request title. */
    closes: boolean("closes").notNull().default(false),
    authorLogin: text("author_login"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
  },
  (t) => [
    unique("code_link_ref").on(t.repoId, t.refKey, t.targetKey),
    index("code_link_system_idx").on(t.systemId),
    index("code_link_repo_sha_idx").on(t.repoId, t.sha),
  ],
);

/** A person's linked GitHub login. */
export const githubAccount = pgTable("github_account", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  linkedAt: timestamp("linked_at", tz).notNull().defaultNow(),
});

/** A row of {@link githubApp}. */
export type GitHubAppRow = typeof githubApp.$inferSelect;
/** A row of {@link githubInstallation}. */
export type GitHubInstallationRow = typeof githubInstallation.$inferSelect;
/** A row of {@link githubRepo}. */
export type GitHubRepoRow = typeof githubRepo.$inferSelect;
/** A row of {@link codeLink}. */
export type CodeLinkRow = typeof codeLink.$inferSelect;
/** A row of {@link githubAccount}. */
export type GitHubAccountRow = typeof githubAccount.$inferSelect;
