import "server-only";
import { z } from "zod";
import { askRoundInput } from "@/lib/event-questions";
import { REQUEST_STATUSES } from "@/lib/event-status";
import { dbInt } from "@/lib/ops/params";
import { acceptInput, acceptRequest, briefStatus, linkableProjects, requestOfProject, requestProgress } from "@/lib/ops/request-link";
import { answerQuestions, answerQuestionsInput, askRound, listRounds } from "@/lib/ops/request-questions";
import {
  cancelRequest,
  compareBriefs,
  createRequest,
  createRequestInput,
  getBrief,
  getRequest,
  listBriefVersions,
  listRequests,
  markDone,
  recallRequest,
  requestHistory,
  saveBrief,
  saveBriefInput,
  submitRequest,
  updateRequest,
  updateRequestInput,
  withdrawRequest,
} from "@/lib/ops/requests";
import { deleteUpload, setBanner, setBannerInput } from "@/lib/ops/uploads";
import { protectedProcedure, router } from "../init";

/** The request a procedure acts on. */
const R = { id: z.string().min(1).max(64) };

/** Event requests: the list and page, status changes and brief versions. */
export const requestsRouter = router({
  /** The requests the actor may see, open ones first. */
  list: protectedProcedure
    .input(z.object({ status: z.array(z.enum(REQUEST_STATUSES)).optional(), mine: z.boolean().optional(), scope: z.enum(["open", "all"]).optional() }))
    .query(({ ctx, input }) => listRequests(ctx.db, ctx.actor, input)),

  /** A request with its current brief and the actor's rights. */
  get: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => getRequest(ctx.db, ctx.actor, input.id)),

  /** Files a draft request (event managers and admins). */
  create: protectedProcedure.input(createRequestInput).mutation(({ ctx, input }) => createRequest(ctx.db, ctx.actor, input)),

  /** Changes the title, date, duration, place, docs link or requester. */
  update: protectedProcedure
    .input(z.object({ ...R, ...updateRequestInput.shape }))
    .mutation(({ ctx, input: { id, ...patch } }) => updateRequest(ctx.db, ctx.actor, id, patch)),

  /** Saves the brief as the next version. */
  saveBrief: protectedProcedure
    .input(z.object({ ...R, ...saveBriefInput.shape }))
    .mutation(({ ctx, input: { id, ...brief } }) => saveBrief(ctx.db, ctx.actor, id, brief)),

  /** A version of the brief, the current one without `version`. */
  brief: protectedProcedure.input(z.object({ ...R, version: dbInt.optional() })).query(({ ctx, input }) => getBrief(ctx.db, ctx.actor, input.id, input.version)),

  /** The brief versions, newest first. */
  briefVersions: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => listBriefVersions(ctx.db, ctx.actor, input.id)),

  /** The line differences between two brief versions. */
  compareBriefs: protectedProcedure
    .input(z.object({ ...R, from: dbInt, to: dbInt }))
    .query(({ ctx, input }) => compareBriefs(ctx.db, ctx.actor, input.id, input.from, input.to)),

  /** Submits a draft. */
  submit: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => submitRequest(ctx.db, ctx.actor, input.id)),

  /** Takes a submitted request back to a draft. */
  recall: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => recallRequest(ctx.db, ctx.actor, input.id)),

  /** Withdraws a draft or submitted request. */
  withdraw: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => withdrawRequest(ctx.db, ctx.actor, input.id)),

  /** Cancels an accepted request with a reason. */
  cancel: protectedProcedure
    .input(z.object({ ...R, reason: z.string() }))
    .mutation(({ ctx, input }) => cancelRequest(ctx.db, ctx.actor, input.id, input.reason)),

  /** Marks an event-week request as done. */
  markDone: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => markDone(ctx.db, ctx.actor, input.id)),

  /** The history of a request, newest first. */
  history: protectedProcedure
    .input(z.object({ ...R, limit: z.number().int().min(1).max(500).optional() }))
    .query(({ ctx, input }) => requestHistory(ctx.db, ctx.actor, input.id, input.limit)),

  /** Asks a round of one to five typed questions (developers). */
  askRound: protectedProcedure
    .input(z.object({ ...R, ...askRoundInput.shape }))
    .mutation(({ ctx, input: { id, ...round } }) => askRound(ctx.db, ctx.actor, id, round)),

  /** Answers questions with a typed value or "not sure" (the requester or an event manager). */
  answerQuestions: protectedProcedure
    .input(z.object({ ...R, ...answerQuestionsInput.shape }))
    .mutation(({ ctx, input: { id, ...answers } }) => answerQuestions(ctx.db, ctx.actor, id, answers)),

  /** The question rounds of a request with their answers. */
  rounds: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => listRounds(ctx.db, ctx.actor, input.id)),

  /** Accepts a submitted request into a new or an existing project (admins and event developers). */
  accept: protectedProcedure
    .input(z.intersection(z.object(R), acceptInput))
    .mutation(({ ctx, input: { id, ...rest } }) => acceptRequest(ctx.db, ctx.actor, id, rest)),

  /** The build progress of a request's project as task counts. */
  progress: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => requestProgress(ctx.db, ctx.actor, input.id)),

  /** The projects the actor may link a request to, with their systems. */
  linkable: protectedProcedure.query(({ ctx }) => linkableProjects(ctx.db, ctx.actor)),

  /** The request a project was built for, with whether the actor may open it. */
  forProject: protectedProcedure.input(z.object({ project: z.string().min(1).max(64) })).query(({ ctx, input }) => requestOfProject(ctx.db, ctx.actor, input.project)),

  /** Whether the spec of a request's system still matches its brief, by project or by request; null without a request. */
  briefStatus: protectedProcedure
    .input(z.union([z.object({ project: z.string().min(1).max(64) }), z.object(R)]))
    .query(({ ctx, input }) => briefStatus(ctx.db, ctx.actor, "project" in input ? { projectSlug: input.project } : { requestId: input.id })),

  /** Sets or clears the banner image of a request. */
  setBanner: protectedProcedure.input(setBannerInput).mutation(({ ctx, input }) => setBanner(ctx.db, ctx.actor, input)),

  /** Deletes an uploaded image, clearing it as the banner first. */
  deleteUpload: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => deleteUpload(ctx.db, ctx.actor, input.id)),
});
