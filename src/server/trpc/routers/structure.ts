import "server-only";
import { z } from "zod";
import {
  createDomain,
  createPhase,
  deleteDomain,
  deletePhase,
  domainInput,
  listDomains,
  listPhases,
  phaseInput,
  reorderDomains,
  reorderInput,
  reorderPhases,
  updateDomain,
  updateDomainInput,
  updatePhase,
  updatePhaseInput,
} from "@/lib/ops/structure";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** The project and one of its domains or phases. */
const ITEM = { ...P, id: z.string().min(1) };

/** Domains and phases of a project. */
export const structureRouter = router({
  /** The project's domains in order. */
  domains: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listDomains(ctx.db, ctx.actor, input.project)),

  /** The project's phases in delivery order, with their dependencies. */
  phases: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => listPhases(ctx.db, ctx.actor, input.project)),

  /** Adds a domain. */
  createDomain: protectedProcedure
    .input(z.object({ ...P, domain: domainInput }))
    .mutation(async ({ ctx, input }) => void (await createDomain(ctx.db, ctx.actor, input.project, input.domain))),

  /** Changes a domain's name or description. */
  updateDomain: protectedProcedure
    .input(z.object({ ...ITEM, patch: updateDomainInput }))
    .mutation(async ({ ctx, input }) => void (await updateDomain(ctx.db, ctx.actor, input.project, input.id, input.patch))),

  /** Deletes a domain. */
  deleteDomain: protectedProcedure.input(z.object(ITEM)).mutation(({ ctx, input }) => deleteDomain(ctx.db, ctx.actor, input.project, input.id)),

  /** Puts the project's domains into the given order. */
  reorderDomains: protectedProcedure
    .input(z.object({ ...P, ...reorderInput.shape }))
    .mutation(async ({ ctx, input }) => void (await reorderDomains(ctx.db, ctx.actor, input.project, input.orderedIds))),

  /** Adds a phase. */
  createPhase: protectedProcedure
    .input(z.object({ ...P, phase: phaseInput }))
    .mutation(async ({ ctx, input }) => void (await createPhase(ctx.db, ctx.actor, input.project, input.phase))),

  /** Changes a phase's name, goal or dependencies. */
  updatePhase: protectedProcedure
    .input(z.object({ ...ITEM, patch: updatePhaseInput }))
    .mutation(async ({ ctx, input }) => void (await updatePhase(ctx.db, ctx.actor, input.project, input.id, input.patch))),

  /** Deletes a phase. */
  deletePhase: protectedProcedure.input(z.object(ITEM)).mutation(({ ctx, input }) => deletePhase(ctx.db, ctx.actor, input.project, input.id)),

  /** Puts the project's phases into the given delivery order. */
  reorderPhases: protectedProcedure
    .input(z.object({ ...P, ...reorderInput.shape }))
    .mutation(async ({ ctx, input }) => void (await reorderPhases(ctx.db, ctx.actor, input.project, input.orderedIds))),
});
