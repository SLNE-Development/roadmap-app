import { z } from "zod";
import { DOCUMENT_KINDS } from "@/db/schema";
import { slugSchema } from "@/lib/ops/access";
import { listActivity } from "@/lib/ops/activity";
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
import { createBoard, createBoardInput, listBoards, setBoardColumns, setColumnsInput, updateBoard, updateBoardInput } from "@/lib/ops/boards";
import { getDocument, writePlan, writePlanInput, writeSpec, writeSpecInput } from "@/lib/ops/documents";
import { listMembers } from "@/lib/ops/members";
import { getSystemOverview } from "@/lib/ops/overview";
import { MAX_INT } from "@/lib/ops/params";
import {
  addPlanningRound,
  addRoundInput,
  answerItemsInput,
  answerPlanningItems,
  completePlanning,
  completePlanningInput,
  getPlanning,
  reopenPlanning,
} from "@/lib/ops/planning";
import { createProject, createProjectInput, getProject, listProjects, updateProject, updateProjectInput } from "@/lib/ops/projects";
import { addQuestion, addQuestionInput, answerQuestion, answerQuestionInput, listQuestions } from "@/lib/ops/questions";
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
import { addTask, addTaskInput, moveTask, moveTaskInput, updateTask, updateTaskInput } from "@/lib/ops/tasks";
import { listUpdates, postUpdate, postUpdateInput } from "@/lib/ops/updates";
import { defineTool, register, registeredTools, type ToolDef } from "./registry";

/** The project a tool acts in. */
const P = { project: slugSchema.describe("Project slug, e.g. surf-roleplay.") };

/** The project and system a tool acts on. */
const S = { ...P, system: slugSchema.describe("System slug within the project.") };

/** The project and board a tool acts on. */
const B = { ...P, board: slugSchema.describe("Board slug within the project, e.g. development.") };

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
const limit = positiveInt(500).optional().describe("Maximum number of entries.");

register(
  defineTool({
    name: "whoami",
    description: "Who the API key belongs to, and the projects they can access with their role.",
    input: {},
    write: false,
    method: "GET",
    path: "/whoami",
    run: async (db, actor) => ({ userId: actor.userId, name: actor.name, isAdmin: actor.isAdmin, projects: await listProjects(db, actor) }),
  }),

  defineTool({
    name: "list_projects",
    description: "List the projects you can access, with your role in each.",
    input: {},
    write: false,
    method: "GET",
    path: "/projects",
    run: (db, actor) => listProjects(db, actor),
  }),
  defineTool({
    name: "get_project",
    description: "Get a project with your role, its boards (with columns and their categories) and its custom fields.",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project",
    run: (db, actor, i) => getProject(db, actor, i.project),
  }),
  defineTool({
    name: "create_project",
    description: "Create a project. You become its owner; it starts with a Development board.",
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
    description: "List project members with user ids (usable as ownerUserId), roles and when they joined (joinedAt).",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/members",
    run: (db, actor, i) => listMembers(db, actor, i.project),
  }),

  defineTool({
    name: "list_boards",
    description: "List a project's boards with their columns (id, name, category).",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/boards",
    run: (db, actor, i) => listBoards(db, actor, i.project),
  }),
  defineTool({
    name: "create_board",
    description: "Add a board (a workstream such as Building) with the default columns (owner only).",
    input: { ...P, ...createBoardInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/boards",
    run: (db, actor, { project, ...input }) => createBoard(db, actor, project, input),
  }),
  defineTool({
    name: "update_board",
    description: "Rename a board or change its position (owner only).",
    input: { ...B, ...updateBoardInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/boards/:board",
    run: (db, actor, { project, board, ...patch }) => updateBoard(db, actor, project, board, patch),
  }),
  defineTool({
    name: "set_board_columns",
    description:
      "Replace a board's columns, in order. Keep existing columns by passing their id. Exactly one column must have category planning and at least one done (owner only).",
    input: { ...B, ...setColumnsInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/boards/:board/columns",
    run: (db, actor, { project, board, ...input }) => setBoardColumns(db, actor, project, board, input),
  }),

  defineTool({
    name: "list_domains",
    description: "List a project's domains (areas that group systems).",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/domains",
    run: (db, actor, i) => listDomains(db, actor, i.project),
  }),
  defineTool({
    name: "create_domain",
    description: "Add a domain to a project.",
    input: { ...P, ...domainInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/domains",
    run: (db, actor, { project, ...input }) => createDomain(db, actor, project, input),
  }),
  defineTool({
    name: "update_domain",
    description: "Rename a domain or change its description (id from list_domains).",
    input: { ...P, id: z.string().min(1).describe("Domain id from list_domains."), ...updateDomainInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/domains/:id",
    run: (db, actor, { project, id, ...patch }) => updateDomain(db, actor, project, id, patch),
  }),
  defineTool({
    name: "reorder_domains",
    description: "Reorder a project's domains. orderedIds lists every domain id exactly once, in the new order.",
    input: { ...P, ...reorderInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/domains/order",
    run: (db, actor, i) => reorderDomains(db, actor, i.project, i.orderedIds),
  }),
  defineTool({
    name: "list_phases",
    description: "List a project's delivery phases in order with their dependencies.",
    input: P,
    write: false,
    method: "GET",
    path: "/projects/:project/phases",
    run: (db, actor, i) => listPhases(db, actor, i.project),
  }),
  defineTool({
    name: "create_phase",
    description: "Add a delivery phase, optionally building on other phases (ids).",
    input: { ...P, ...phaseInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/phases",
    run: (db, actor, { project, ...input }) => createPhase(db, actor, project, input),
  }),
  defineTool({
    name: "update_phase",
    description:
      "Rename a phase, change its goal or replace its dependencies (phase ids; [] clears them). A phase cannot depend on itself or form a cycle.",
    input: { ...P, id: z.string().min(1).describe("Phase id from list_phases."), ...updatePhaseInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/phases/:id",
    run: (db, actor, { project, id, ...patch }) => updatePhase(db, actor, project, id, patch),
  }),
  defineTool({
    name: "reorder_phases",
    description: "Reorder a project's delivery phases. orderedIds lists every phase id exactly once, in the new delivery order.",
    input: { ...P, ...reorderInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/phases/order",
    run: (db, actor, i) => reorderPhases(db, actor, i.project, i.orderedIds),
  }),

  defineTool({
    name: "list_systems",
    description: "List systems with board, column, owner, planning state and task progress. Filter by board, domain, phase, column category, priority, owner (user id or none), startable (no unfinished dependencies), or archived (exclude by default, include or only).",
    input: { ...P, ...systemFilter.shape },
    write: false,
    method: "GET",
    path: "/projects/:project/systems",
    run: (db, actor, { project, ...filter }) => listSystems(db, actor, project, filter),
  }),
  defineTool({
    name: "get_system",
    description: "Get one system: board and column, tasks (with ids), latest spec and plan, planning state and gaps, questions, linked ADRs and recent updates.",
    input: S,
    write: false,
    method: "GET",
    path: "/projects/:project/systems/:system",
    run: (db, actor, i) => getSystemOverview(db, actor, i.project, i.system),
  }),
  defineTool({
    name: "create_system",
    description: "Create a system on a board (default: the first). It starts in the planning column; run the surf-roadmap:plan-system interview next.",
    input: { ...P, ...createSystemInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems",
    run: (db, actor, { project, ...input }) => createSystem(db, actor, project, input),
  }),
  defineTool({
    name: "update_system",
    description: "Change a system's title, summary, priority, owner (user id or null), notes, domain or phase.",
    input: { ...S, ...updateSystemInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/systems/:system",
    run: (db, actor, { project, system, ...patch }) => updateSystem(db, actor, project, system, patch),
  }),
  defineTool({
    name: "set_dependencies",
    description: "Set which systems this system depends on (replaces the list); cycles are rejected.",
    input: { ...S, ...setDependenciesInput.shape },
    write: true,
    method: "PUT",
    path: "/projects/:project/systems/:system/dependencies",
    run: (db, actor, { project, system, ...input }) => setDependencies(db, actor, project, system, input),
  }),
  defineTool({
    name: "set_system_fields",
    description: "Set custom field values of a system by key (see get_project fields); null clears one.",
    input: { ...S, values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) },
    write: true,
    method: "PATCH",
    path: "/projects/:project/systems/:system/fields",
    run: (db, actor, { project, system, values }) => setSystemFields(db, actor, project, system, { values }),
  }),
  defineTool({
    name: "move_system",
    description:
      "Move a system to a column (id or name) of its board or of another board. Leaving planning requires complete_planning; moving into an active column makes you owner of an unowned system.",
    input: { ...S, ...moveSystemInput.shape },
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
    description: "Get a system's planning interview: every round with questions, areas, risk flags, answers and states, plus the gaps that still block completion.",
    input: S,
    write: false,
    method: "GET",
    path: "/projects/:project/systems/:system/planning",
    run: (db, actor, i) => getPlanning(db, actor, i.project, i.system),
  }),
  defineTool({
    name: "add_planning_round",
    description: "Record the next round of planning questions BEFORE asking them. Each item has an area (failure-modes, dependencies, scope, ops-testing) and isRisk for failure modes.",
    input: { ...S, ...addRoundInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/rounds",
    run: (db, actor, { project, system, ...input }) => addPlanningRound(db, actor, project, system, input),
  }),
  defineTool({
    name: "answer_planning_items",
    description: "Store the user's answers right after they give them. Use status accepted-risk only when the user explicitly accepts a flagged risk, with their reason as the answer.",
    input: { ...S, ...answerItemsInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/answers",
    run: (db, actor, { project, system, ...input }) => answerPlanningItems(db, actor, project, system, input),
  }),
  defineTool({
    name: "complete_planning",
    description: "Complete planning once every area is covered, nothing is open and the spec is written. userConfirmation must quote the user's own words confirming the spec.",
    input: { ...S, ...completePlanningInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/complete",
    run: (db, actor, { project, system, ...input }) => completePlanning(db, actor, project, system, input),
  }),
  defineTool({
    name: "reopen_planning",
    description: "Reopen a system's planning and move it back to the planning column.",
    input: S,
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/planning/reopen",
    run: (db, actor, i) => reopenPlanning(db, actor, i.project, i.system),
  }),

  defineTool({
    name: "get_document",
    description: "Get a system's spec or plan: the latest version, or a given version, with the list of all versions.",
    input: { ...S, kind: z.enum(DOCUMENT_KINDS), version: positiveInt(MAX_INT).optional() },
    write: false,
    method: "GET",
    path: "/projects/:project/systems/:system/documents/:kind",
    run: async (db, actor, i) => (await getDocument(db, actor, i.project, i.system, i.kind, i.version)) ?? { document: null },
  }),
  defineTool({
    name: "write_spec",
    description: "Write a new version of a system's spec (markdown). Specs live here, never as repository files.",
    input: { ...S, ...writeSpecInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/spec",
    run: (db, actor, { project, system, ...input }) => writeSpec(db, actor, project, system, input),
  }),
  defineTool({
    name: "write_plan",
    description:
      "Write a new version of a system's implementation plan (markdown) with its numbered steps. Each new step becomes a task; renamed steps rename their task; dropped steps are reported, never deleted.",
    input: { ...S, ...writePlanInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/plan",
    run: (db, actor, { project, system, ...input }) => writePlan(db, actor, project, system, input),
  }),

  defineTool({
    name: "add_task",
    description: "Add a task to a system, optionally with an estimate (S, M, L).",
    input: { ...S, ...addTaskInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/tasks",
    run: (db, actor, { project, system, ...input }) => addTask(db, actor, project, system, input),
  }),
  defineTool({
    name: "update_task",
    description:
      "Change a task's title, state, priority, owner, notes, blockedReason or estimate (S, M, L, or null to clear). Blocked needs a blockedReason; doing and done need completed planning.",
    input: { id: intParam("Task id from get_system."), ...updateTaskInput.shape },
    write: true,
    method: "PATCH",
    path: "/tasks/:id",
    run: (db, actor, { id, ...patch }) => updateTask(db, actor, id, patch),
  }),
  defineTool({
    name: "move_task",
    description: "Move a task to another system of the same project; it keeps its state, owner and checklist.",
    input: { id: intParam("Task id."), ...moveTaskInput.shape },
    write: true,
    method: "POST",
    path: "/tasks/:id/move",
    run: (db, actor, { id, ...rest }) => moveTask(db, actor, id, rest),
  }),
  defineTool({
    name: "set_task_checks",
    description: "Replace a task's checklist; items matched by title keep their state unless done is given.",
    input: { id: intParam("Task id."), ...setTaskChecksInput.shape },
    write: true,
    method: "PUT",
    path: "/tasks/:id/checks",
    run: (db, actor, { id, ...rest }) => setTaskChecks(db, actor, id, rest),
  }),

  defineTool({
    name: "post_update",
    description: "Post a progress update on a system after each commit: summary, optional next step, task id and commit hash (may be unpushed).",
    input: { ...S, ...postUpdateInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/updates",
    run: (db, actor, { project, system, ...input }) => postUpdate(db, actor, project, system, input),
  }),
  defineTool({
    name: "list_updates",
    description: "List progress updates, newest first, optionally for one system; each names the person (authorName) and the agent, if any.",
    input: { ...P, system: z.string().optional(), limit },
    write: false,
    method: "GET",
    path: "/projects/:project/updates",
    run: (db, actor, { project, ...filter }) => listUpdates(db, actor, project, filter),
  }),

  defineTool({
    name: "list_adrs",
    description: "List a project's ADRs by number, optionally by status or linked system.",
    input: { ...P, ...adrFilter.shape },
    write: false,
    method: "GET",
    path: "/projects/:project/adrs",
    run: (db, actor, { project, ...filter }) => listAdrs(db, actor, project, filter),
  }),
  defineTool({
    name: "get_adr",
    description: "Get one ADR with context, decision, alternatives and consequences.",
    input: { ...P, number: intParam("ADR number.") },
    write: false,
    method: "GET",
    path: "/projects/:project/adrs/:number",
    run: (db, actor, i) => getAdr(db, actor, i.project, i.number),
  }),
  defineTool({
    name: "create_adr",
    description:
      "Record a decision the user has made as a proposed ADR. Every section is required; alternatives state their real advantage first; consequences name gains, costs, follow-on work and what is foreclosed.",
    input: { ...P, ...createAdrInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/adrs",
    run: (db, actor, { project, ...input }) => createAdr(db, actor, project, input),
  }),
  defineTool({
    name: "update_adr",
    description: "Edit a proposed ADR. Accepted ADRs are immutable; supersede them instead.",
    input: { ...P, number: intParam("ADR number."), ...updateAdrInput.shape },
    write: true,
    method: "PATCH",
    path: "/projects/:project/adrs/:number",
    run: (db, actor, { project, number, ...patch }) => updateAdr(db, actor, project, number, patch),
  }),
  defineTool({
    name: "accept_adr",
    description: "Accept a proposed ADR once the user confirms it. It becomes immutable.",
    input: { ...P, number: intParam("ADR number.") },
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
    description: "List open questions, unresolved first, optionally for one system or by resolved state; answered ones say who answered (answeredBy) and when (answeredAt).",
    input: { ...P, system: z.string().optional(), resolved: z.boolean().optional() },
    write: false,
    method: "GET",
    path: "/projects/:project/questions",
    run: (db, actor, { project, ...filter }) => listQuestions(db, actor, project, filter),
  }),
  defineTool({
    name: "add_question",
    description: "Add an open question, optionally tied to a system (for example when blocked).",
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
    name: "list_activity",
    description: "List the project's change log, newest first, optionally one system's history.",
    input: { ...P, system: z.string().optional(), limit },
    write: false,
    method: "GET",
    path: "/projects/:project/activity",
    run: (db, actor, { project, ...filter }) => listActivity(db, actor, project, filter),
  }),
);

/** Every tool, in definition order. */
export const TOOLS: readonly ToolDef[] = registeredTools();

/** Names of every tool. */
export const TOOL_NAMES: readonly string[] = TOOLS.map((t) => t.name);
