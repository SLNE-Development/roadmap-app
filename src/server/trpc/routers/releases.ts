import "server-only";
import { z } from "zod";
import {
  createRelease,
  createReleaseInput,
  deleteRelease,
  freezeRelease,
  getRelease,
  getReleaseNote,
  listReleases,
  shipRelease,
  shipReleaseInput,
  unfreezeRelease,
  updateRelease,
  updateReleaseInput,
  writeReleaseNote,
} from "@/lib/ops/releases";
import { dbInt } from "@/lib/ops/params";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** A release of a project, addressed by its slug. */
const R = { ...P, release: z.string().min(1).max(64) };

/** Releases: scheduled groups of systems with a target date, freeze and ship steps and versioned notes. */
export const releasesRouter = router({
  /** The project's releases with target date, status and done counts. */
  list: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listReleases(ctx.db, ctx.actor, input.project)),

  /** A release's systems, readiness, open questions, slip risk and newest note. */
  get: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => getRelease(ctx.db, ctx.actor, input.project, input.release)),

  /** Creates a planned release. */
  create: protectedProcedure
    .input(z.object({ ...P, release: createReleaseInput }))
    .mutation(({ ctx, input }) => createRelease(ctx.db, ctx.actor, input.project, input.release)),

  /** Renames a release or changes its slug or target date. */
  update: protectedProcedure
    .input(z.object({ ...R, patch: updateReleaseInput }))
    .mutation(({ ctx, input }) => updateRelease(ctx.db, ctx.actor, input.project, input.release, input.patch)),

  /** Freezes a planned release's scope. */
  freeze: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => freezeRelease(ctx.db, ctx.actor, input.project, input.release)),

  /** Makes a frozen release planned again. */
  unfreeze: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => unfreezeRelease(ctx.db, ctx.actor, input.project, input.release)),

  /** Ships a release; unfinished systems block it or are moved out. */
  ship: protectedProcedure
    .input(z.object({ ...R, ...shipReleaseInput.shape }))
    .mutation(({ ctx, input: { project, release, ...rest } }) => shipRelease(ctx.db, ctx.actor, project, release, rest)),

  /** Deletes a planned release; its systems become unassigned. */
  delete: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => deleteRelease(ctx.db, ctx.actor, input.project, input.release)),

  /** A version of a release's notes, the newest when `version` is omitted. */
  note: protectedProcedure
    .input(z.object({ ...R, version: dbInt.optional() }))
    .query(({ ctx, input }) => getReleaseNote(ctx.db, ctx.actor, input.project, input.release, input.version)),

  /** Writes a new version of a release's notes. */
  writeNote: protectedProcedure
    .input(z.object({ ...R, body: z.string().trim().min(1).max(200_000) }))
    .mutation(({ ctx, input }) => writeReleaseNote(ctx.db, ctx.actor, input.project, input.release, input.body)),
});
