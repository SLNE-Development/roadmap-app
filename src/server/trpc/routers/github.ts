import "server-only";
import { z } from "zod";
import { getGitHubApi } from "@/lib/github/api";
import { ForbiddenError } from "@/lib/ops/errors";
import { myGitHubAccount, startGitHubLink, unlinkGitHub } from "@/lib/ops/github-accounts";
import {
  appCredentialsInput,
  appHealth,
  dismissInstallRequest,
  getAppSummary,
  githubAppConfigured,
  linkPolicyInput,
  listInstallations,
  listInstallRequests,
  rotateWebhookSecret,
  saveAppCredentials,
  setLinkPolicy,
  startInstall,
  startManifest,
  startManifestInput,
} from "@/lib/ops/github-app";
import {
  availableRepos,
  installMoreUrl,
  linkAppRepo,
  linkManualRepo,
  linkRepoInput,
  listLinkedRepos,
  pickableRepos,
  repoLinkStatus,
  repoRulesInput,
  revealRepoSecret,
  setRepoRules,
  unlinkRepo,
} from "@/lib/ops/github-repos";
import { entityId } from "@/lib/ops/params";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

const R = { id: entityId };

/**
 * The GitHub App of this instance: setup, installations, health and settings, admin only; and the repositories
 * linked to a project.
 */
export const githubRouter = router({
  /** The App without its secrets, or null before it is set up. */
  app: protectedProcedure.query(({ ctx }) => getAppSummary(ctx.db, ctx.actor)),

  /** Webhook health: the last delivery and failures of the last 24 hours. */
  health: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.actor.isAdmin) throw new ForbiddenError("Only admins can manage the GitHub App.");
    return appHealth(ctx.db, await getGitHubApi(ctx.db), ctx.actor, new Date());
  }),

  /** The App's installations. */
  installations: protectedProcedure.query(({ ctx }) => listInstallations(ctx.db, ctx.actor)),

  /** Open install requests of the last 30 days. */
  installRequests: protectedProcedure.query(({ ctx }) => listInstallRequests(ctx.db, ctx.actor)),

  /** Starts creating the App from a manifest; the browser posts the manifest to `action`. */
  startManifest: protectedProcedure.input(startManifestInput).mutation(({ ctx, input }) => startManifest(ctx.db, ctx.kv, ctx.actor, input)),

  /** Stores the credentials of an App registered by hand. */
  saveCredentials: protectedProcedure
    .input(z.object({ credentials: appCredentialsInput }))
    .mutation(({ ctx, input }) => saveAppCredentials(ctx.db, ctx.actor, input.credentials)),

  /** Starts installing the App on an account; the browser opens `url`. */
  startInstall: protectedProcedure.input(z.object({ returnTo: z.string().max(2048).optional() })).mutation(({ ctx, input }) => {
    if (!ctx.actor.isAdmin) throw new ForbiddenError("Only admins can manage the GitHub App.");
    return startInstall(ctx.db, ctx.kv, ctx.actor, input);
  }),

  /** Dismisses an install request. */
  dismissRequest: protectedProcedure
    .input(z.object({ id: z.string().min(1).max(64) }))
    .mutation(({ ctx, input }) => dismissInstallRequest(ctx.db, ctx.actor, input.id)),

  /** Replaces the webhook secret on GitHub and here. */
  rotateSecret: protectedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.actor.isAdmin) throw new ForbiddenError("Only admins can manage the GitHub App.");
    return rotateWebhookSecret(ctx.db, await getGitHubApi(ctx.db), ctx.actor, new Date());
  }),

  /** Sets who may link repositories to projects. */
  setLinkPolicy: protectedProcedure
    .input(z.object({ policy: linkPolicyInput }))
    .mutation(({ ctx, input }) => setLinkPolicy(ctx.db, ctx.actor, input.policy)),

  /** The project's linked repositories. Viewer or higher. */
  repos: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listLinkedRepos(ctx.db, ctx.actor, input.project)),

  /** Whether an App is set up and whether the actor may link repositories in the project. */
  linkStatus: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => repoLinkStatus(ctx.db, ctx.actor, input.project)),

  /** The repositories the App can see, with where each is linked. */
  availableRepos: protectedProcedure
    .input(z.object(P))
    .query(async ({ ctx, input }) => availableRepos(ctx.db, ctx.kv, await getGitHubApi(ctx.db), ctx.actor, input.project)),

  /** The repositories the App can see for a form without a project yet, and whether the actor may link one. */
  pickableRepos: protectedProcedure.query(async ({ ctx }) => pickableRepos(ctx.db, ctx.kv, await getGitHubApi(ctx.db), ctx.actor)),

  /** Links a repository the App can see. */
  linkAppRepo: protectedProcedure
    .input(z.object({ ...P, repo: linkRepoInput }))
    .mutation(async ({ ctx, input }) => linkAppRepo(ctx.db, ctx.kv, await getGitHubApi(ctx.db), ctx.actor, input.project, input.repo)),

  /** Links a repository by hand; the answer carries its webhook URL and secret. */
  linkManualRepo: protectedProcedure
    .input(z.object({ ...P, repo: linkRepoInput }))
    .mutation(({ ctx, input }) => linkManualRepo(ctx.db, ctx.actor, input.project, input.repo, ctx.kv)),

  /** The webhook URL and secret of a repository linked by hand. */
  revealSecret: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => revealRepoSecret(ctx.db, ctx.actor, input.id)),

  /** Unlinks a repository. */
  unlink: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => unlinkRepo(ctx.db, ctx.actor, input.id)),

  /** Changes a repository's automation rules. */
  setRules: protectedProcedure
    .input(z.object({ ...R, rules: repoRulesInput }))
    .mutation(({ ctx, input }) => setRepoRules(ctx.db, ctx.actor, input.id, input.rules)),

  /** Starts installing the App on more repositories, returning to the project's GitHub settings. */
  installMoreUrl: protectedProcedure.input(z.object(P)).mutation(({ ctx, input }) => installMoreUrl(ctx.db, ctx.kv, ctx.actor, input.project)),

  /** Whether an App is set up, and the actor's linked GitHub login. Any signed-in user. */
  account: protectedProcedure.query(async ({ ctx }) => ({
    configured: await githubAppConfigured(ctx.db),
    account: await myGitHubAccount(ctx.db, ctx.actor),
  })),

  /** Starts linking the actor's GitHub login; the browser opens `url`. */
  startLink: protectedProcedure.mutation(({ ctx }) => startGitHubLink(ctx.db, ctx.kv, ctx.actor)),

  /** Removes the actor's linked GitHub login. */
  unlinkAccount: protectedProcedure.mutation(({ ctx }) => unlinkGitHub(ctx.db, ctx.actor)),
});
