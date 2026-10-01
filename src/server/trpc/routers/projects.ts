import "server-only";
import { z } from "zod";
import { archiveProject, restoreProject } from "@/lib/ops/archive";
import { projectAttention } from "@/lib/ops/attention";
import { archivedFilter, createProject, createProjectInput, deleteProject, getProject, listProjects, updateProject, updateProjectInput } from "@/lib/ops/projects";
import { projectNav, projectSummaries } from "@/lib/ops/summaries";
import { protectedProcedure, router } from "../init";
import { P } from "./shared";

/** Which projects the list and cards return by archive state; archived ones are left out by default. */
const listInput = z.object({ archived: archivedFilter.optional() }).optional();

/** Projects: the list, one project with its boards, sidebar numbers, home cards, and changes. */
export const projectsRouter = router({
  /** The projects the actor belongs to (every project for admins), by name. */
  list: protectedProcedure.input(listInput).query(({ ctx, input }) => listProjects(ctx.db, ctx.actor, input)),

  /** The projects with their home-page numbers: systems by category, open questions and last change. */
  cards: protectedProcedure.input(listInput).query(async ({ ctx, input }) => {
    const list = await listProjects(ctx.db, ctx.actor, input);
    const summaries = await projectSummaries(ctx.db, list.map((p) => p.id));
    return list.map((p) => ({ ...p, summary: summaries.get(p.id) ?? null }));
  }),

  /** One project with the actor's role and its boards. */
  get: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => getProject(ctx.db, ctx.actor, input.project)),

  /** What the project sidebar and command menu show. */
  nav: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => projectNav(ctx.db, ctx.actor, input.project)),

  /** What needs attention in the project: blocked and stale work, planning, proposed decisions and old or blocking questions. */
  attention: protectedProcedure.input(z.object(P)).query(({ ctx, input }) => projectAttention(ctx.db, ctx.actor, input.project, new Date())),

  /** Creates a project owned by the actor and returns its slug. */
  create: protectedProcedure
    .input(createProjectInput)
    .mutation(async ({ ctx, input }) => ({ slug: (await createProject(ctx.db, ctx.actor, input)).slug })),

  /** Changes the project's name, description or repository URL. */
  update: protectedProcedure
    .input(z.object({ ...P, patch: updateProjectInput }))
    .mutation(async ({ ctx, input }) => void (await updateProject(ctx.db, ctx.actor, input.project, input.patch))),

  /** Archives the project: hidden from the lists and read-only until restored. Owner only. */
  archive: protectedProcedure.input(z.object(P)).mutation(({ ctx, input }) => archiveProject(ctx.db, ctx.actor, input.project)),

  /** Restores an archived project. Owner only. */
  restore: protectedProcedure.input(z.object(P)).mutation(({ ctx, input }) => restoreProject(ctx.db, ctx.actor, input.project)),

  /** Deletes the project and everything in it. */
  delete: protectedProcedure.input(z.object(P)).mutation(({ ctx, input }) => deleteProject(ctx.db, ctx.actor, input.project)),
});
