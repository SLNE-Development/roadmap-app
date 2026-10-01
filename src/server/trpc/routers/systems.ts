import "server-only";
import { z } from "zod";
import { setDependencies, setDependenciesInput } from "@/lib/ops/dependencies";
import { getSystemOverview } from "@/lib/ops/overview";
import { getProject } from "@/lib/ops/projects";
import { createSystem, createSystemInput, listSystems, moveSystem, moveSystemInput, systemFilter, updateSystem, updateSystemInput } from "@/lib/ops/systems";
import { latestUpdates } from "@/lib/ops/updates";
import { protectedProcedure, router } from "../init";
import { P, S } from "./shared";

/** Systems of a project. */
export const systemsRouter = router({
  /** The project's systems matching the filter, in board then system order. */
  list: protectedProcedure
    .input(z.object({ ...P, filter: systemFilter.optional() }))
    .query(({ ctx, input }) => listSystems(ctx.db, ctx.actor, input.project, input.filter)),

  /** One system with its spec, plan, planning state, questions, ADRs and newest 200 updates. */
  overview: protectedProcedure
    .input(z.object(S))
    .query(({ ctx, input }) => getSystemOverview(ctx.db, ctx.actor, input.project, input.system, 200)),

  /** The newest progress update of every system that has one, keyed by system id. */
  latestUpdates: protectedProcedure.input(z.object(P)).query(async ({ ctx, input }) => {
    const { project } = await getProject(ctx.db, ctx.actor, input.project);
    return latestUpdates(ctx.db, project.id);
  }),

  /** Creates a system in planning and returns its slug. */
  create: protectedProcedure
    .input(z.object({ ...P, system: createSystemInput }))
    .mutation(async ({ ctx, input }) => ({ slug: (await createSystem(ctx.db, ctx.actor, input.project, input.system)).slug })),

  /** Changes a system's fields. */
  update: protectedProcedure
    .input(z.object({ ...S, patch: updateSystemInput }))
    .mutation(async ({ ctx, input }) => void (await updateSystem(ctx.db, ctx.actor, input.project, input.system, input.patch))),

  /** Moves a system to a column; the planning gate applies. */
  move: protectedProcedure
    .input(z.object({ ...S, to: moveSystemInput }))
    .mutation(async ({ ctx, input }) => void (await moveSystem(ctx.db, ctx.actor, input.project, input.system, input.to))),

  /** Replaces the systems this system depends on; a cycle is a conflict. */
  setDependencies: protectedProcedure
    .input(z.object({ ...S, ...setDependenciesInput.shape }))
    .mutation(({ ctx, input }) => setDependencies(ctx.db, ctx.actor, input.project, input.system, { dependsOn: input.dependsOn })),
});
