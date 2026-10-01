import { z } from "zod";
import { DOCUMENT_KINDS, QUESTION_PRIORITIES } from "@/db/schema";
import { slugSchema } from "@/lib/ops/access";
import { listActivity } from "@/lib/ops/activity";
import { recordUsage, recordUsageInput, startRun, startRunInput } from "@/lib/ops/agent-runs";
import {
  acceptAdr,
  adrFilter,
  createAdr,
  createAdrInput,
  getAdr,
  listAdrs,
  supersedeAdr,
  updateAdr,
  updateAdrInput,
} from "@/lib/ops/adrs";
import { addTasks, addTasksInput, answerQuestions, answerQuestionsInput, updateTasks, updateTasksInput } from "@/lib/ops/batch";
import {
  createBoard,
  createBoardInput,
  listBoards,
  setBoardColumns,
  setColumnRules,
  setColumnRulesInput,
  setColumnsInput,
  updateBoard,
  updateBoardInput,
} from "@/lib/ops/boards";
import { InvalidError } from "@/lib/ops/errors";
import { getDocument, writePlan, writePlanInput, writeSpec, writeSpecInput } from "@/lib/ops/documents";
import { GATE_RULES } from "@/lib/ops/gates";
import { deleteGlossaryTerm, listGlossary, setGlossaryTerm, setGlossaryTermInput } from "@/lib/ops/glossary";
import { listMembers } from "@/lib/ops/members";
import { getPage, listPages, writePage, writePageInput } from "@/lib/ops/pages";
import { searchProjectInput, searchProjectWithRefs } from "@/lib/ops/search";
import { getSystemOverview } from "@/lib/ops/overview";
import { myWork } from "@/lib/ops/my-work";
import { MAX_INT } from "@/lib/ops/params";
import {
  addPlanningRound,
  addRoundInput,
  answerItemsInput,
  answerPlanningItems,
  completeAreaInput,
  completePlanning,
  completePlanningArea,
  completePlanningInput,
  getPlanning,
  reopenAreaInput,
  reopenPlanning,
  reopenPlanningArea,
} from "@/lib/ops/planning";
import { createProject, createProjectInput, getProject, listProjects, updateProject, updateProjectInput } from "@/lib/ops/projects";
import { addQuestion, addQuestionInput, answerQuestion, answerQuestionInput, listQuestions, setQuestionPriority } from "@/lib/ops/questions";
import { similarSystems } from "@/lib/ops/similar";
import {
  createDomain,
  createPhase,
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
import {
  createSystem,
  createSystemInput,
  listSystems,
  moveSystem,
  moveSystemInput,
  systemFilter,
  updateSystem,
  updateSystemInput,
} from "@/lib/ops/systems";
import { setTaskChecks, setTaskChecksInput } from "@/lib/ops/checks";
import { setDependencies, setDependenciesInput } from "@/lib/ops/dependencies";
import { setSystemFields } from "@/lib/ops/fields";
import { setSystemArchived } from "@/lib/ops/archive";
import { moveTask, moveTaskInput, updateTask, updateTaskInput } from "@/lib/ops/tasks";
import { listUpdates, postUpdate, postUpdateInput } from "@/lib/ops/updates";
import { BRIEF, briefActivity, briefAdrs, briefOverview } from "./brief";
import { defineTool, register, registeredTools, type ToolContext, type ToolDef } from "./registry";

/** The project a tool acts in. */
const P = { project: slugSchema };

/** The project and system a tool acts on. */
const S = { ...P, system: slugSchema };

/** The project and board a tool acts on. */
const B = { ...P, board: slugSchema };

/**
 * Turns a numeric string (REST path and query values) into a number and leaves
 * anything else as is, so a missing value still fails as "required" instead of
 * being coerced to `NaN` the way `z.coerce.number()` does.
 */
const fromNumericString = (value: unknown): unknown =>
  typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : value;

/** A positive integer up to `max`, accepted as a number (MCP, JSON bodies) or a numeric string (REST). */
const positiveInt = (max: number) => z.preprocess(fromNumericString, z.number().int().min(1).max(max));

/** A required numeric path parameter (a positive 32-bit integer) accepted as a number (MCP) or a numeric string (REST). */
const intParam = (what: string) => positiveInt(MAX_INT).describe(what);

/** An optional result limit accepted as a number or a numeric string. */
const limit = positiveInt(500).optional();

/**
 * Returns the API key a call came with.
 *
 * @throws InvalidError when the call has none
 */
function apiKeyOf(ctx: ToolContext | undefined): string {
  if (!ctx?.apiKeyId) throw new InvalidError("Agent runs need a call made with an API key.");
  return ctx.apiKeyId;
}

register(
  defineTool({
    name: "whoami",
    description: "Your user and the projects you can access, with roles.",
    input: {},
    write: false,
    method: "GET",
    path: "/whoami",
    run: async (db, actor) => ({ userId: actor.userId, name: actor.name, isAdmin: actor.isAdmin, projects: await listProjects(db, actor) }),
  }),

  defineTool({
    name: "my_work",
    description: "Your waiting work: blocked and doing tasks, open planning items and questions, proposed ADRs.",
    input: {},
    write: false,
    method: "GET",
    path: "/my-work",
    run: async (db, actor) =>
      (await myWork(db, actor, { now: new Date(), changesLimit: 1 }))
        .filter((i) => i.section === "waiting")
        .map((i) => ({ kind: i.kind, project: i.projectSlug, system: i.systemSlug, title: i.title, detail: i.detail })),
  }),
  defineTool({
    name: "list_projects",
    description: "List accessible projects with your role.",
    input: {},
    write: false,
    method: "GET",
    path: "/projects",
    run: (db, actor) => listProjects(db, actor),
  }),
  defineTool({
    name: "get_project",
    description: "Get a project with your role, boards (columns) and custom fields.",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project",
    run: (db, actor, i) => getProject(db, actor, i.project),
  }),
  defineTool({
    name: "create_project",
    description: "Create a project; you become owner. It starts with a Development board.",
    input: createProjectInput.shape,
    write: true,
    method: "POST",
    path: "/projects",
    run: (db, actor, i) => createProject(db, actor, i),
  }),
  defineTool({
    name: "update_project",
    description: "Change a project's name, description or repository URL (owner only).",
    input: { ...P, ...updateProjectInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project",
    run: (db, actor, { project, ...patch }) => updateProject(db, actor, project, patch),
  }),
  defineTool({
    name: "list_members",
    description: "List members with user ids (ownerUserId), roles and joinedAt.",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/members",
    run: (db, actor, i) => listMembers(db, actor, i.project),
  }),

  defineTool({
    name: "list_boards",
    description: "List boards with columns (id, name, category, entry rules).",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/boards",
    run: async (db, actor, i) =>
      (await listBoards(db, actor, i.project)).map((b) => ({
        ...b,
        columns: b.columns.map((c) => ({ ...c, rules: c.rules.map((r) => ({ ...r, label: GATE_RULES.get(r.rule)?.label(r.param) })) })),
      })),
  }),
  defineTool({
    name: "create_board",
    description: "Add a board (workstream) with default columns (owner only).",
    input: { ...P, ...createBoardInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/boards",
    run: (db, actor, { project, ...input }) => createBoard(db, actor, project, input),
  }),
  defineTool({
    name: "update_board",
    description: "Rename or reposition a board (owner only).",
    input: { ...B, ...updateBoardInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/boards/:board",
    run: (db, actor, { project, board, ...patch }) => updateBoard(db, actor, project, board, patch),
  }),
  defineTool({
    name: "set_board_columns",
    description:
      "Replace a board's columns in order, passing existing ids to keep them; needs one planning and one done column (owner only).",
    input: { ...B, ...setColumnsInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/boards/:board/columns",
    run: (db, actor, { project, board, ...input }) => setBoardColumns(db, actor, project, board, input),
  }),
  defineTool({
    name: "set_column_rules",
    description: "Set a column's entry rules (owner only); [] removes them.",
    input: { ...B, ...setColumnRulesInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/boards/:board/columns/rules",
    run: (db, actor, { project, board, ...input }) => setColumnRules(db, actor, project, board, input),
  }),

  defineTool({
    name: "list_domains",
    description: "List domains (areas that group systems).",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/domains",
    run: (db, actor, i) => listDomains(db, actor, i.project),
  }),
  defineTool({
    name: "create_domain",
    description: "Add a domain.",
    input: { ...P, ...domainInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/domains",
    run: (db, actor, { project, ...input }) => createDomain(db, actor, project, input),
  }),
  defineTool({
    name: "update_domain",
    description: "Rename a domain or change its description.",
    input: { ...P, id: z.string().min(1), ...updateDomainInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/domains/:id",
    run: (db, actor, { project, id, ...patch }) => updateDomain(db, actor, project, id, patch),
  }),
  defineTool({
    name: "reorder_domains",
    description: "Reorder domains; orderedIds lists every id once.",
    input: { ...P, ...reorderInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/domains/order",
    run: (db, actor, i) => reorderDomains(db, actor, i.project, i.orderedIds),
  }),
  defineTool({
    name: "list_phases",
    description: "List delivery phases in order with dependencies.",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/phases",
    run: (db, actor, i) => listPhases(db, actor, i.project),
  }),
  defineTool({
    name: "create_phase",
    description: "Add a delivery phase, optionally depending on other phases.",
    input: { ...P, ...phaseInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/phases",
    run: (db, actor, { project, ...input }) => createPhase(db, actor, project, input),
  }),
  defineTool({
    name: "update_phase",
    description:
      "Rename a phase, change its goal or replace its dependencies ([] clears); no cycles.",
    input: { ...P, id: z.string().min(1), ...updatePhaseInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/phases/:id",
    run: (db, actor, { project, id, ...patch }) => updatePhase(db, actor, project, id, patch),
  }),
  defineTool({
    name: "reorder_phases",
    description: "Reorder delivery phases; orderedIds lists every id once.",
    input: { ...P, ...reorderInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/phases/order",
    run: (db, actor, i) => reorderPhases(db, actor, i.project, i.orderedIds),
  }),

  defineTool({
    name: "list_systems",
    description: "List systems with column, owner, planning state and task progress, optionally filtered.",
    input: { ...P, ...systemFilter.shape },
    write: false,
    method: "GET",
    path: "/projects/:project/systems",
    run: (db, actor, { project, ...filter }) => listSystems(db, actor, project, filter),
  }),
  defineTool({
    name: "get_system",
    description: "Get a system: column, tasks (with ids), planning, questions, ADRs, updates. get_document gives spec and plan text.",
    input: { ...S, ...BRIEF },
    write: false,
    method: "GET",
    path: "/projects/:project/systems/:system",
    run: async (db, actor, i) => {
      const overview = await getSystemOverview(db, actor, i.project, i.system);
      return i.brief === false ? overview : briefOverview(overview);
    },
  }),
  defineTool({
    name: "create_system",
    description:
      "Create a system in the planning column, then run the surf-roadmap:plan-system interview. Lists `similar` systems.",
    input: { ...P, ...createSystemInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems",
    run: async (db, actor, { project, ...input }) => {
      // Looked up before the insert, so the new system never lists itself.
      const similar = input.title.trim().length >= 3 ? await similarSystems(db, actor, project, { title: input.title }) : [];
      return { ...(await createSystem(db, actor, project, input)), similar };
    },
  }),
  defineTool({
    name: "update_system",
    description: "Change a system's title, summary, priority, owner, notes, domain or phase.",
    input: { ...S, ...updateSystemInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/systems/:system",
    run: (db, actor, { project, system, ...patch }) => updateSystem(db, actor, project, system, patch),
  }),
  defineTool({
    name: "set_dependencies",
    description: "Replace the systems this one depends on; cycles are rejected.",
    input: { ...S, ...setDependenciesInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/systems/:system/dependencies",
    run: (db, actor, { project, system, ...input }) => setDependencies(db, actor, project, system, input),
  }),
  defineTool({
    name: "set_system_fields",
    description: "Set custom field values by key (see get_project); null clears.",
    input: { ...S, values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) },
    write: true,
    method: "PATCH",
    path: "/projects/:project/systems/:system/fields",
    run: (db, actor, { project, system, values }) => setSystemFields(db, actor, project, system, { values }),
  }),
  defineTool({
    name: "get_glossary",
    description: "List glossary terms; use these words in specs and plans.",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/glossary",
    run: (db, actor, { project }) => listGlossary(db, actor, project),
  }),
  defineTool({
    name: "set_glossary_term",
    description: "Add or change a glossary term; delete: true removes it.",
    input: { ...P, ...setGlossaryTermInput.shape, definition: setGlossaryTermInput.shape.definition.optional(), delete: z.boolean().optional() },
    write: true,
    method: "PUT",
    path: "/projects/:project/glossary",
    run: async (db, actor, { project, delete: remove, definition, ...input }) => {
      if (remove) {
        await deleteGlossaryTerm(db, actor, project, input.term);
        return { term: input.term, deleted: true };
      }
      if (definition === undefined) throw new InvalidError("definition is required unless delete is true.");
      return setGlossaryTerm(db, actor, project, { ...input, definition });
    },
  }),
  defineTool({
    name: "list_pages",
    description: "List project pages with their latest version.",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/pages",
    run: (db, actor, { project }) => listPages(db, actor, project),
  }),
  defineTool({
    name: "get_page",
    description: "Get a page, a given version, or only its diff since a version.",
    input: {
      ...P,
      page: slugSchema,
      version: positiveInt(MAX_INT).optional(),
      since: positiveInt(MAX_INT).optional(),
    },
    write: false,
    method: "GET",
    path: "/projects/:project/pages/:page",
    run: (db, actor, i) => (i.since === undefined ? getPage(db, actor, i.project, i.page, i.version) : getPage(db, actor, i.project, i.page, i.version, i.since)),
  }),
  defineTool({
    name: "write_page",
    description: "Write a page's next version (markdown); title required for a new page.",
    input: { ...P, ...writePageInput.omit({ create: true }).shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/pages/:page",
    run: (db, actor, { project, ...input }) => writePage(db, actor, project, input),
  }),
  defineTool({
    name: "search",
    description: "Full-text search across systems, documents, ADRs, questions and pages; returns refs and snippets.",
    input: {
      ...P,
      ...searchProjectInput.shape,
      // REST passes query values as strings: kinds may come comma-separated, limit as a numeric string.
      kinds: z.preprocess((v) => (typeof v === "string" ? v.split(",") : v), searchProjectInput.shape.kinds),
      limit: positiveInt(50).optional(),
    },
    write: false,
    method: "GET",
    path: "/projects/:project/search",
    run: async (db, actor, { project, ...input }) =>
      (await searchProjectWithRefs(db, actor, project, input)).map((hit) => ({
        kind: hit.kind,
        title: hit.title,
        ref: hit.ref,
        snippet: hit.snippet.replace(/[\u0002\u0003]/g, "**"),
      })),
  }),
  defineTool({
    name: "move_system",
    description:
      "Move a system to a column (id or name). Leaving planning needs complete_planning; column rules may refuse; an active column makes you owner of an unowned system.",
    input: {
      ...S,
      ...moveSystemInput.shape,
      overrideReason: moveSystemInput.shape.overrideReason.describe("Owner only: move despite unmet column rules; the reason is logged."),
    },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/move",
    run: (db, actor, { project, system, ...input }) => moveSystem(db, actor, project, system, input),
  }),
  defineTool({
    name: "archive_system",
    description: "Archive a system (hidden, read-only) or restore it with restore: true.",
    input: { ...S, restore: z.boolean().default(false) },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/archive",
    run: (db, actor, { project, system, restore }) => setSystemArchived(db, actor, project, system, !restore),
  }),

  defineTool({
    name: "get_planning",
    description: "Get a system's planning rounds, answers, completion gaps and per-area coverage.",
    input: S,
    write: false,
    method: "GET",
    path: "/projects/:project/systems/:system/planning",
    run: (db, actor, i) => getPlanning(db, actor, i.project, i.system),
  }),
  defineTool({
    name: "add_planning_round",
    description: "Record the next round of planning questions BEFORE asking them; items have an area, and isRisk for failure modes.",
    input: { ...S, ...addRoundInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/rounds",
    run: (db, actor, { project, system, ...input }) => addPlanningRound(db, actor, project, system, input),
  }),
  defineTool({
    name: "answer_planning_items",
    description: "Store the user's answers right after they give them. Use accepted-risk only when the user explicitly accepts a flagged risk, with their reason.",
    input: { ...S, ...answerItemsInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/answers",
    run: (db, actor, { project, system, ...input }) => answerPlanningItems(db, actor, project, system, input),
  }),
  defineTool({
    name: "complete_planning",
    description: "Complete planning once every area is covered, nothing is open and the spec is written. userConfirmation quotes the user's confirming words.",
    input: { ...S, ...completePlanningInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/complete",
    run: (db, actor, { project, system, ...input }) => completePlanning(db, actor, project, system, input),
  }),
  defineTool({
    name: "reopen_planning",
    description: "Reopen the whole interview, moving the system back to planning; prefer reopen_planning_area.",
    input: S,
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/reopen",
    run: (db, actor, i) => reopenPlanning(db, actor, i.project, i.system),
  }),
  defineTool({
    name: "reopen_planning_area",
    description: "Reopen one planning area of a completed system, with a reason, without moving it; only that area accepts new rounds.",
    input: { ...S, ...reopenAreaInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/areas/reopen",
    run: (db, actor, { project, system, ...input }) => reopenPlanningArea(db, actor, project, system, input),
  }),
  defineTool({
    name: "complete_planning_area",
    description: "Close a reopened planning area once answered; userConfirmation quotes the user's words.",
    input: { ...S, ...completeAreaInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/areas/complete",
    run: (db, actor, { project, system, ...input }) => completePlanningArea(db, actor, project, system, input),
  }),

  defineTool({
    name: "get_document",
    description: "Get a spec or plan (latest or a version) and its versions; since returns only the diff.",
    input: {
      ...S,
      kind: z.enum(DOCUMENT_KINDS),
      version: positiveInt(MAX_INT).optional(),
      since: positiveInt(MAX_INT).optional(),
    },
    write: false,
    method: "GET",
    path: "/projects/:project/systems/:system/documents/:kind",
    run: async (db, actor, i) => {
      const doc = i.since === undefined ? await getDocument(db, actor, i.project, i.system, i.kind, i.version) : await getDocument(db, actor, i.project, i.system, i.kind, i.version, i.since);
      return doc ?? { document: null };
    },
  }),
  defineTool({
    name: "write_spec",
    description: "Write a new version of a system's spec (markdown).",
    input: { ...S, ...writeSpecInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/spec",
    run: (db, actor, { project, system, ...input }) => writeSpec(db, actor, project, system, input),
  }),
  defineTool({
    name: "write_plan",
    description:
      "Write a new plan version (markdown) with numbered steps: new steps become tasks, renamed steps rename theirs, dropped steps are only reported.",
    input: { ...S, ...writePlanInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/plan",
    run: (db, actor, { project, system, ...input }) => writePlan(db, actor, project, system, input),
  }),

  defineTool({
    name: "add_tasks",
    description: "Add up to 50 tasks in one call; a clientRef per task makes a retry return the same tasks.",
    input: { ...S, ...addTasksInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/tasks",
    run: (db, actor, { project, system, ...input }) => addTasks(db, actor, project, system, input),
  }),
  defineTool({
    name: "update_task",
    description:
      "Change a task's title, state, priority, owner, notes, blockedReason or estimate. Blocked needs blockedReason; doing and done need completed planning.",
    input: { id: positiveInt(MAX_INT), ...updateTaskInput.shape },
    write: true,
    method: "PATCH",
    path: "/tasks/:id",
    run: (db, actor, { id, ...patch }) => updateTask(db, actor, id, patch),
  }),
  defineTool({
    name: "update_tasks",
    description: "Change several tasks in one call, same fields as update_task.",
    input: updateTasksInput.shape,
    write: true,
    method: "PATCH",
    path: "/tasks",
    run: (db, actor, input) => updateTasks(db, actor, input),
  }),
  defineTool({
    name: "move_task",
    description: "Move a task to another system of the project; state, owner and checklist stay.",
    input: { id: positiveInt(MAX_INT), ...moveTaskInput.shape },
    write: true,
    method: "POST",
    path: "/tasks/:id/move",
    run: (db, actor, { id, ...rest }) => moveTask(db, actor, id, rest),
  }),
  defineTool({
    name: "set_task_checks",
    description: "Replace a task's checklist; items matched by title keep their state.",
    input: { id: positiveInt(MAX_INT), ...setTaskChecksInput.shape },
    write: true,
    method: "PUT",
    path: "/tasks/:id/checks",
    run: (db, actor, { id, ...rest }) => setTaskChecks(db, actor, id, rest),
  }),

  defineTool({
    name: "post_update",
    description: "Post a progress update after each commit: summary, next step, task id, commit hash.",
    input: { ...S, ...postUpdateInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/updates",
    run: (db, actor, { project, system, ...input }) => postUpdate(db, actor, project, system, input),
  }),
  defineTool({
    name: "list_updates",
    description: "List progress updates, newest first, optionally for one system.",
    input: { ...P, system: z.string().optional(), limit },
    write: false,
    method: "GET",
    path: "/projects/:project/updates",
    run: (db, actor, { project, ...filter }) => listUpdates(db, actor, project, filter),
  }),

  defineTool({
    name: "list_adrs",
    description: "List ADRs by number, optionally by status or system; use get_adr for full text.",
    input: { ...P, ...adrFilter.shape, ...BRIEF },
    write: false,
    method: "GET",
    path: "/projects/:project/adrs",
    run: async (db, actor, { project, brief, ...filter }) => {
      const rows = await listAdrs(db, actor, project, filter);
      return brief === false ? rows : briefAdrs(rows);
    },
  }),
  defineTool({
    name: "get_adr",
    description: "Get an ADR with context, decision, alternatives, consequences, tasks, history.",
    input: { ...P, number: positiveInt(MAX_INT) },
    write: false,
    method: "GET",
    path: "/projects/:project/adrs/:number",
    run: (db, actor, i) => getAdr(db, actor, i.project, i.number),
  }),
  defineTool({
    name: "create_adr",
    description:
      "Record a user decision as a proposed ADR. Alternatives state their real advantage first; consequences name gains, costs, follow-on work and what is foreclosed.",
    input: { ...P, ...createAdrInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/adrs",
    run: (db, actor, { project, ...input }) => createAdr(db, actor, project, input),
  }),
  defineTool({
    name: "update_adr",
    description: "Edit a proposed ADR; accepted ADRs are immutable, supersede them. systems and tasks may still change.",
    input: { ...P, number: positiveInt(MAX_INT), ...updateAdrInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/adrs/:number",
    run: (db, actor, { project, number, ...patch }) => updateAdr(db, actor, project, number, patch),
  }),
  defineTool({
    name: "accept_adr",
    description: "Accept a proposed ADR once the user confirms it. It becomes immutable.",
    input: { ...P, number: positiveInt(MAX_INT) },
    write: true,
    method: "POST",
    path: "/projects/:project/adrs/:number/accept",
    run: (db, actor, i) => acceptAdr(db, actor, i.project, i.number),
  }),
  defineTool({
    name: "supersede_adr",
    description: "Mark accepted ADR number as superseded by accepted ADR by.",
    input: { ...P, number: intParam("The ADR being superseded."), by: intParam("The accepted ADR that replaces it.") },
    write: true,
    method: "POST",
    path: "/projects/:project/adrs/:number/supersede",
    run: (db, actor, i) => supersedeAdr(db, actor, i.project, { number: i.number, by: i.by }),
  }),

  defineTool({
    name: "list_questions",
    description: "List questions, unresolved first, optionally for one system or by resolved state.",
    input: { ...P, system: z.string().optional(), resolved: z.boolean().optional() },
    write: false,
    method: "GET",
    path: "/projects/:project/questions",
    run: (db, actor, { project, ...filter }) => listQuestions(db, actor, project, filter),
  }),
  defineTool({
    name: "add_question",
    description: "Add an open question, optionally for a system (e.g. when blocked). Priority blocking holds the planning gate.",
    input: { ...P, ...addQuestionInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/questions",
    run: (db, actor, { project, ...input }) => addQuestion(db, actor, project, input),
  }),
  defineTool({
    name: "answer_question",
    description: "Record the answer to a question; resolves it unless resolved is false.",
    input: { ...P, ...answerQuestionInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/questions/:id/answer",
    run: (db, actor, { project, ...input }) => answerQuestion(db, actor, project, input),
  }),
  defineTool({
    name: "answer_questions",
    description: "Answer questions in one call; each resolves unless resolved is false.",
    input: { ...P, ...answerQuestionsInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/questions/answers",
    run: (db, actor, { project, ...input }) => answerQuestions(db, actor, project, input),
  }),
  defineTool({
    name: "set_question_priority",
    description: "Set a question's priority: blocking, normal or nice.",
    input: { ...P, id: z.string().min(1), priority: z.enum(QUESTION_PRIORITIES) },
    write: true,
    method: "PATCH",
    path: "/projects/:project/questions/:id/priority",
    run: (db, actor, { project, id, priority }) => setQuestionPriority(db, actor, project, id, priority),
  }),

  defineTool({
    name: "list_activity",
    description: "List the change log, newest first, optionally one system's; long values are cut.",
    input: { ...P, system: z.string().optional(), limit, ...BRIEF },
    write: false,
    method: "GET",
    path: "/projects/:project/activity",
    run: async (db, actor, { project, brief, ...filter }) => {
      const rows = await listActivity(db, actor, project, filter);
      return brief === false ? rows : briefActivity(rows);
    },
  }),

  defineTool({
    name: "start_agent_run",
    description: "Start an agent run for this key that its next calls join; a known clientSessionId returns that run.",
    input: startRunInput.shape,
    write: false,
    method: "POST",
    path: "/agent-runs",
    surface: "rest",
    run: (db, actor, input, ctx) => startRun(db, actor, apiKeyOf(ctx), input),
  }),
  defineTool({
    name: "report_agent_usage",
    description: "Set the token totals of the run with this clientSessionId, replacing earlier totals.",
    input: recordUsageInput.shape,
    write: false,
    method: "POST",
    path: "/agent-runs/usage",
    surface: "rest",
    run: (db, actor, input, ctx) => recordUsage(db, actor, apiKeyOf(ctx), input),
  }),
);

/** Every tool, in definition order. */
export const TOOLS: readonly ToolDef[] = registeredTools();

/** Names of every tool. */
export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);
