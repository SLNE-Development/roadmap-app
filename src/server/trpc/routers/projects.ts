import "server-only";
import { z } from "zod";
import { createProject, createProjectInput, deleteProject, getProject, listProjects, updateProject, updateProjectInput } from "@/lib/ops/projects";
import { projectNav, projectSummaries } from "@/lib/ops/summaries";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** Projects: the list, one project with its boards, sidebar numbers, home cards, and changes. */
export const projectsRouter = router({
  /** The projects the actor belongs to (every project for admins), by name. */
  list: protectedProcedure.query(({ ctx }) => listProjects(ctx.db, ctx.actor)),

  /** The projects with their home-page numbers: systems by category, open questions and last change. */
  cards: protectedProcedure.query(async ({ ctx }) => {
    const list = await listProjects(ctx.db, ctx.actor);
    const summaries = await projectSummaries(ctx.db, list.map((p) => p.id));
    return list.map((p) => ({ ...p, summary: summaries.get(p.id) ?? null }));
  }),

  /** One project with the actor's role and its boards. */
  get: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => getProject(ctx.db, ctx.actor, input.project)),

  /** What the project sidebar and command menu show. */
  nav: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => projectNav(ctx.db, ctx.actor, input.project)),

  /** Creates a project owned by the actor and returns its slug. */
  create: protectedProcedure
    .input(createProjectInput)
    .mutation(async ({ ctx, input }) => ({ slug: (await createProject(ctx.db, ctx.actor, input)).slug })),

  /** Changes the project's name, description or repository URL. */
  update: protectedProcedure
    .input(z.object({ ...P, patch: updateProjectInput }))
    .mutation(async ({ ctx, input }) => void (await updateProject(ctx.db, ctx.actor, input.project, input.patch))),

  /** Deletes the project and everything in it. */
  delete: protectedProcedure.input(z.object(P)).mutation(({ ctx, input }) => deleteProject(ctx.db, ctx.actor, input.project)),
});
