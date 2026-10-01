import "server-only";
import { z } from "zod";
import { POST_KINDS } from "@/lib/event-messages";
import { askRoundInput } from "@/lib/event-questions";
import { REQUEST_STATUSES } from "@/lib/event-status";
import { dbInt } from "@/lib/ops/params";
import { acceptInput, acceptRequest, briefStatus, linkableProjects, requestOfProject, requestProgress } from "@/lib/ops/request-link";
import { addFallbackInput, addFallback, listFallbacks, removeFallback, saveFallback, saveFallbackInput } from "@/lib/ops/request-fallback";
import {
  addChecklistItem,
  addChecklistItemInput,
  addTodo,
  addTodoInput,
  eventDayView,
  listChecklist,
  listOwnerChoices,
  listTodos,
  removeChecklistItem,
  removeTodo,
  setChecklistItem,
  setTodoDone,
  updateTodo,
  updateTodoInput,
} from "@/lib/ops/request-prep";
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
  startEventWeek,
  submitRequest,
  updateRequest,
  updateRequestInput,
  withdrawRequest,
} from "@/lib/ops/requests";
import { getEventSettings, previewTemplate, setEventSecrets, updateEventSettings } from "@/lib/ops/event-settings";
import { deletePost, disasterView, editPost, editPostInput, listPosts, postDisaster, previewPost, resolveDisaster, resolveDisasterInput, resumePost, savePostDraft, savePostDraftInput, startPost, testResult, testSend } from "@/lib/ops/request-posts";
import { getPrompts, savePasteBack, savePasteBackInput } from "@/lib/ops/request-prompts";
import { deleteUpload, setBanner, setBannerInput } from "@/lib/ops/uploads";
import { bullQueue, QUEUE } from "@/lib/queue";
import { protectedProcedure, router } from "../init";

/** The request a procedure acts on. */
const R = { id: z.string().min(1).max(64) };

/** The request and the kind of post a procedure acts on. */
const POST = { ...R, kind: z.enum(POST_KINDS) };

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
    .mutation(({ ctx, input: { id, ...patch } }) => updateRequest(ctx.db, ctx.actor, id, patch, bullQueue(QUEUE.deliver))),

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
    .mutation(({ ctx, input }) => cancelRequest(ctx.db, ctx.actor, input.id, input.reason, bullQueue(QUEUE.deliver))),

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

  /** Starts the event week once the fallback plan is complete. */
  startEventWeek: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => startEventWeek(ctx.db, ctx.actor, input.id)),

  /** The fallback scenarios of a request. */
  fallbacks: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => listFallbacks(ctx.db, ctx.actor, input.id)),

  /** Changes a fallback scenario. */
  saveFallback: protectedProcedure
    .input(z.object({ ...R, fallbackId: z.string().min(1).max(64), ...saveFallbackInput.shape }))
    .mutation(({ ctx, input: { id, fallbackId, ...patch } }) => saveFallback(ctx.db, ctx.actor, id, fallbackId, patch)),

  /** Adds a custom fallback scenario. */
  addFallback: protectedProcedure.input(z.object({ ...R, ...addFallbackInput.shape })).mutation(({ ctx, input: { id, ...rest } }) => addFallback(ctx.db, ctx.actor, id, rest)),

  /** Removes a custom fallback scenario. */
  removeFallback: protectedProcedure
    .input(z.object({ ...R, fallbackId: z.string().min(1).max(64) }))
    .mutation(({ ctx, input }) => removeFallback(ctx.db, ctx.actor, input.id, input.fallbackId)),

  /** The prep to-dos of a request with their late flag. */
  todos: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => listTodos(ctx.db, ctx.actor, input.id)),

  /** The people a to-do can be given to. */
  owners: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => listOwnerChoices(ctx.db, ctx.actor, input.id)),

  /** Adds a custom to-do. */
  addTodo: protectedProcedure.input(z.object({ ...R, ...addTodoInput.shape })).mutation(({ ctx, input: { id, ...rest } }) => addTodo(ctx.db, ctx.actor, id, rest)),

  /** Changes the title, owner or due date of a to-do. */
  updateTodo: protectedProcedure
    .input(z.object({ todoId: z.string().min(1).max(64), ...updateTodoInput.shape }))
    .mutation(({ ctx, input: { todoId, ...patch } }) => updateTodo(ctx.db, ctx.actor, todoId, patch)),

  /** Ticks or unticks a to-do. */
  setTodoDone: protectedProcedure
    .input(z.object({ todoId: z.string().min(1).max(64), done: z.boolean() }))
    .mutation(({ ctx, input }) => setTodoDone(ctx.db, ctx.actor, input.todoId, input.done)),

  /** Removes a custom to-do. */
  removeTodo: protectedProcedure.input(z.object({ todoId: z.string().min(1).max(64) })).mutation(({ ctx, input }) => removeTodo(ctx.db, ctx.actor, input.todoId)),

  /** The event-day checklist. */
  checklist: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => listChecklist(ctx.db, ctx.actor, input.id)),

  /** Ticks or unticks a checklist item (event week only). */
  setChecklistItem: protectedProcedure
    .input(z.object({ itemId: z.string().min(1).max(64), done: z.boolean() }))
    .mutation(({ ctx, input }) => setChecklistItem(ctx.db, ctx.actor, input.itemId, input.done)),

  /** Adds a custom checklist item. */
  addChecklistItem: protectedProcedure
    .input(z.object({ ...R, ...addChecklistItemInput.shape }))
    .mutation(({ ctx, input: { id, ...rest } }) => addChecklistItem(ctx.db, ctx.actor, id, rest)),

  /** Removes a custom checklist item. */
  removeChecklistItem: protectedProcedure.input(z.object({ itemId: z.string().min(1).max(64) })).mutation(({ ctx, input }) => removeChecklistItem(ctx.db, ctx.actor, input.itemId)),

  /** The event-day page: event, checklist, fallback scenarios; open to every signed-in user in the event week. */
  eventDay: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => eventDayView(ctx.db, ctx.actor, input.id)),

  /** The three copy prompts (announcement, reminder, team) built from the request; calls nothing. */
  prompts: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => getPrompts(ctx.db, ctx.actor, input.id)),

  /** The Discord posts of a request: drafts, the plan, and the buttons that start or resume a send. A click only queues a job. */
  posts: router({
    /** The live posts with progress, due dates, late flags and which webhooks are set. */
    list: protectedProcedure.input(z.object(R)).query(({ ctx, input }) => listPosts(ctx.db, ctx.actor, input.id)),

    /** Stores text pasted back from a chat assistant as the draft of the matching post; sends nothing. */
    savePasteBack: protectedProcedure
      .input(z.object({ ...R, ...savePasteBackInput.shape }))
      .mutation(({ ctx, input }) => savePasteBack(ctx.db, ctx.actor, input.id, input.kind, input.text, bullQueue(QUEUE.deliver))),

    /** Saves the draft of one post. */
    saveDraft: protectedProcedure
      .input(z.object({ ...POST, ...savePostDraftInput.shape }))
      .mutation(({ ctx, input: { id, kind, ...draft } }) => savePostDraft(ctx.db, ctx.actor, id, kind, draft)),

    /** How many messages a saved post becomes and how long each is; calls nothing. */
    preview: protectedProcedure.input(z.object(POST)).query(({ ctx, input }) => previewPost(ctx.db, ctx.actor, input.id, input.kind)),

    /** Starts posting; returns at once while the worker sends. */
    start: protectedProcedure.input(z.object(POST)).mutation(({ ctx, input }) => startPost(ctx.db, ctx.actor, input.id, input.kind, bullQueue(QUEUE.deliver))),

    /** Continues a partial or failed post where it stopped. */
    resume: protectedProcedure.input(z.object(POST)).mutation(({ ctx, input }) => resumePost(ctx.db, ctx.actor, input.id, input.kind, bullQueue(QUEUE.deliver))),

    /** Changes a posted post's text; the worker updates the stored Discord messages in place and never pings. */
    edit: protectedProcedure
      .input(z.object({ ...POST, ...editPostInput.shape }))
      .mutation(({ ctx, input: { id, kind, ...changes } }) => editPost(ctx.db, ctx.actor, id, kind, changes, bullQueue(QUEUE.deliver))),

    /** Deletes the Discord messages of a post. */
    delete: protectedProcedure.input(z.object(POST)).mutation(({ ctx, input }) => deletePost(ctx.db, ctx.actor, input.id, input.kind, bullQueue(QUEUE.deliver))),

    /** Queues a test send of the draft to the staff channel. */
    testSend: protectedProcedure.input(z.object(POST)).mutation(({ ctx, input }) => testSend(ctx.db, ctx.actor, input.id, input.kind, bullQueue(QUEUE.deliver))),

    /** The outcome of the last test send, while it is kept (60 s). */
    testResult: protectedProcedure.input(z.object(POST)).query(({ ctx, input }) => testResult(ctx.kv, ctx.db, ctx.actor, input.id, input.kind)),

    /** The disaster panel: the post state and the previews of both messages. */
    disasterState: protectedProcedure.input(z.object({ ...R, note: z.string().max(500).optional() })).query(({ ctx, input }) => disasterView(ctx.db, ctx.actor, input.id, input.note ?? "")),

    /** Posts the disaster message (event week only); never pings. */
    disaster: protectedProcedure.input(z.object(R)).mutation(({ ctx, input }) => postDisaster(ctx.db, ctx.actor, input.id, bullQueue(QUEUE.deliver))),

    /** Resolves the posted disaster message with an optional note. */
    resolve: protectedProcedure
      .input(z.object({ ...R, ...resolveDisasterInput.shape }))
      .mutation(({ ctx, input: { id, ...rest } }) => resolveDisaster(ctx.db, ctx.actor, id, rest, bullQueue(QUEUE.deliver))),
  }),

  /** The event settings. Secrets are write-only for admins; no procedure here returns one. */
  settings: router({
    /** The settings with secrets masked (event managers, developers, admins). */
    get: protectedProcedure.query(({ ctx }) => getEventSettings(ctx.db, ctx.actor)),

    /** Changes the managed settings (event managers, admins); a secret key is refused. Inputs are parsed by the op, after the role check. */
    update: protectedProcedure.input(z.unknown()).mutation(({ ctx, input }) => updateEventSettings(ctx.db, ctx.actor, input)),

    /** Sets or clears the webhooks and the bot token (admins only). */
    setSecrets: protectedProcedure.input(z.unknown()).mutation(({ ctx, input }) => setEventSecrets(ctx.db, ctx.actor, input)),

    /** Renders a template with a sample event for the editor preview; sends nothing. */
    preview: protectedProcedure.input(z.unknown()).query(({ ctx, input }) => previewTemplate(ctx.db, ctx.actor, input)),
  }),
});
