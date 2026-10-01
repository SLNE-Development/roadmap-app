import "server-only";
import { z } from "zod";
import { getGitHubApi } from "@/lib/github/api";
import { ForbiddenError } from "@/lib/ops/errors";
import {
  appCredentialsInput,
  appHealth,
  dismissInstallRequest,
  getAppSummary,
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
import { protectedProcedure, router } from "../init";

/** The GitHub App of this instance: setup, installations, health and settings. Admin only. */
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
});
