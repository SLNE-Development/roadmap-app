# Part 5: Tool registry, MCP server, REST API, health check

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index first: its Global Constraints apply to every task.

**Goal:** One registry describing every operation once, served over MCP at `/api/mcp` and over REST at `/api/v1/...`, both authenticated with API keys, plus `/api/health`.

**Spec:** sections 8, 9, 11 (health check).

**Consumes from Parts 1–4:** every op and its zod input from `src/lib/ops/*`, `slugSchema`, `withAgent`, `statusOf`, `messageOf`, `bearerActor`, `getDb`, `listProjects`, `createTestDb`, fixtures.

---

### Task 5.1: Tool registry

**Files:**
- Create: `src/lib/tools/registry.ts`, `src/lib/tools/definitions.ts`
- Test: `src/lib/tools/registry.test.ts`

**Interfaces:**
- Produces:
  - `type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"`
  - `interface ToolDef { name: string; description: string; input: z.ZodRawShape; write: boolean; method: HttpMethod; path: string; run(db: Db, actor: Actor, input: Record<string, unknown>): Promise<unknown> }`
  - `defineTool<S extends z.ZodRawShape>(def): ToolDef` (typed `run` input)
  - `inputSchema(def: ToolDef): z.ZodObject` — adds optional `agent` to write tools
  - `runTool(db: Db, actor: Actor, def: ToolDef, raw: unknown, defaultAgent?: string): Promise<unknown>`
  - `matchRoute(method: string, segments: string[]): { def: ToolDef; params: Record<string, string> } | null`
  - `TOOLS: ToolDef[]` (from `definitions.ts`), `TOOL_NAMES: string[]`

- [ ] **Step 1: Write the failing test**

`src/lib/tools/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { TOOLS } from "./definitions";
import { inputSchema, matchRoute, runTool } from "./registry";

/** Every tool the spec lists, in spec order. */
const SPEC_TOOLS = [
  "whoami",
  "list_projects", "get_project", "create_project", "update_project", "list_members",
  "list_boards", "create_board", "update_board", "set_board_columns",
  "list_domains", "create_domain", "list_phases", "create_phase",
  "list_systems", "get_system", "create_system", "update_system", "move_system",
  "get_planning", "add_planning_round", "answer_planning_items", "complete_planning", "reopen_planning",
  "get_document", "write_spec", "write_plan",
  "add_task", "update_task",
  "post_update", "list_updates",
  "list_adrs", "get_adr", "create_adr", "update_adr", "accept_adr", "supersede_adr",
  "list_questions", "add_question", "answer_question",
  "list_activity",
];

describe("tool registry", () => {
  it("defines exactly the tools of the spec, each once", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual([...SPEC_TOOLS].sort());
  });

  it("gives every tool a unique REST route whose parameters are tool inputs", () => {
    const routes = TOOLS.map((t) => `${t.method} ${t.path}`);
    expect(new Set(routes).size).toBe(routes.length);
    for (const t of TOOLS) {
      for (const param of t.path.split("/").filter((s) => s.startsWith(":"))) {
        expect(Object.keys(t.input), `${t.name} ${param}`).toContain(param.slice(1));
      }
    }
  });

  it("adds an optional agent to write tools only", () => {
    const write = TOOLS.find((t) => t.name === "post_update")!;
    const read = TOOLS.find((t) => t.name === "list_systems")!;
    expect(Object.keys(inputSchema(write).shape)).toContain("agent");
    expect(Object.keys(inputSchema(read).shape)).not.toContain("agent");
  });

  it("matches routes and decodes parameters", () => {
    const m = matchRoute("POST", ["projects", "demo", "systems", "a%2Db", "move"]);
    expect(m?.def.name).toBe("move_system");
    expect(m?.params).toEqual({ project: "demo", system: "a-b" });
    expect(matchRoute("GET", ["projects", "demo", "adrs", "3"])?.def.name).toBe("get_adr");
    expect(matchRoute("DELETE", ["projects"])).toBeNull();
    expect(matchRoute("GET", ["nope"])).toBeNull();
  });

  it("runs a tool with validation and the agent default", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const create = TOOLS.find((t) => t.name === "create_system")!;
    await runTool(db, owner, create, { project: slug, slug: "s", title: "S" }, "Claude Code");
    const post = TOOLS.find((t) => t.name === "post_update")!;
    await runTool(db, owner, post, { project: slug, system: "s", summary: "hi" }, "Claude Code");
    const list = TOOLS.find((t) => t.name === "list_updates")!;
    const updates = (await runTool(db, owner, list, { project: slug })) as { author: string }[];
    expect(updates[0].author).toBe("Claude Code (for Owner)");
    await expect(runTool(db, owner, create, { project: slug })).rejects.toThrow(/slug/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/tools`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the registry core**

`src/lib/tools/registry.ts`:

```ts
import { z } from "zod";
import type { Db } from "@/db/types";
import { withAgent, type Actor } from "@/lib/ops/actor";

/** HTTP methods REST routes use. */
export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** One operation, exposed both as an MCP tool and as a REST route. */
export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodRawShape;
  write: boolean;
  method: HttpMethod;
  path: string;
  run(db: Db, actor: Actor, input: Record<string, unknown>): Promise<unknown>;
}

/** Typed form of {@link ToolDef} used while defining a tool. */
interface TypedToolDef<S extends z.ZodRawShape> extends Omit<ToolDef, "input" | "run"> {
  input: S;
  run(db: Db, actor: Actor, input: z.infer<z.ZodObject<S>>): Promise<unknown>;
}

/** Declares a tool whose `run` receives input typed from its zod shape. */
export function defineTool<S extends z.ZodRawShape>(def: TypedToolDef<S>): ToolDef {
  return { ...def, run: (db, actor, input) => def.run(db, actor, input as z.infer<z.ZodObject<S>>) };
}

/** Optional agent name accepted by every write tool. */
const AGENT = {
  agent: z.string().trim().max(40).optional().describe('Name of the agent making the change, e.g. "Claude Code".'),
};

/** Returns the full input schema of a tool: its shape, plus `agent` for write tools. */
export function inputSchema(def: ToolDef): z.ZodObject<z.ZodRawShape> {
  return z.object(def.write ? { ...def.input, ...AGENT } : def.input);
}

/**
 * Validates `raw` and runs the tool. Write tools act through the given agent,
 * or `defaultAgent` when the input names none.
 *
 * @throws z.ZodError for invalid input, and whatever the op throws
 */
export async function runTool(db: Db, actor: Actor, def: ToolDef, raw: unknown, defaultAgent?: string): Promise<unknown> {
  const { agent, ...input } = inputSchema(def).parse(raw ?? {}) as Record<string, unknown>;
  const who = def.write ? withAgent(actor, (agent as string | undefined) ?? defaultAgent) : actor;
  return def.run(db, who, input);
}

/** Every registered tool; filled by `definitions.ts`. */
const registry: ToolDef[] = [];

/** Adds tools to the registry. */
export function register(...tools: ToolDef[]): void {
  registry.push(...tools);
}

/** Returns the registered tools. */
export function registeredTools(): readonly ToolDef[] {
  return registry;
}

/**
 * Finds the tool whose REST route matches `method` and the URL `segments`
 * after `/api/v1`, with the decoded `:param` values.
 */
export function matchRoute(method: string, segments: string[]): { def: ToolDef; params: Record<string, string> } | null {
  for (const def of registry) {
    if (def.method !== method) continue;
    const pattern = def.path.split("/").filter(Boolean);
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((part, i) => {
      if (part.startsWith(":")) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
        return true;
      }
      return part === segments[i];
    });
    if (ok) return { def, params };
  }
  return null;
}
```

- [ ] **Step 4: Define every tool**

`src/lib/tools/definitions.ts`:

```ts
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
import { createDomain, createPhase, domainInput, listDomains, listPhases, phaseInput } from "@/lib/ops/structure";
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
import { addTask, addTaskInput, updateTask, updateTaskInput } from "@/lib/ops/tasks";
import { listUpdates, postUpdate, postUpdateInput } from "@/lib/ops/updates";
import { defineTool, register, registeredTools, type ToolDef } from "./registry";

/** The project a tool acts in. */
const P = { project: slugSchema.describe("Project slug, e.g. surf-roleplay.") };

/** The project and system a tool acts on. */
const S = { ...P, system: slugSchema.describe("System slug within the project.") };

/** The project and board a tool acts on. */
const B = { ...P, board: slugSchema.describe("Board slug within the project, e.g. development.") };

/** A numeric path parameter accepted as a number (MCP) or a numeric string (REST). */
const intParam = (what: string) => z.coerce.number().int().min(1).describe(what);

/** An optional result limit accepted as a number or a numeric string. */
const limit = z.coerce.number().int().min(1).max(500).optional().describe("Maximum number of entries.");

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
    description: "Get a project with your role and its boards (with columns and their categories).",
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
    description: "List project members with user ids (usable as ownerUserId) and roles.",
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
    name: "list_systems",
    description: "List systems with board, column, owner, planning state and task progress. Filter by board, domain, phase, column category, priority or owner (user id or none).",
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
    input: { ...S, kind: z.enum(DOCUMENT_KINDS), version: z.coerce.number().int().min(1).optional() },
    write: false,
    method: "GET",
    path: "/projects/:project/systems/:system/documents/:kind",
    run: (db, actor, i) => getDocument(db, actor, i.project, i.system, i.kind, i.version),
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
    description: "Add a task to a system.",
    input: { ...S, ...addTaskInput.shape },
    write: true,
    method: "POST",
    path: "/projects/:project/systems/:system/tasks",
    run: (db, actor, { project, system, ...input }) => addTask(db, actor, project, system, input),
  }),
  defineTool({
    name: "update_task",
    description:
      "Change a task's title, state (todo, doing, blocked, done), priority or owner. Setting doing makes you owner of the task and its system when they have none; doing and done need completed planning.",
    input: { id: intParam("Task id from get_system."), ...updateTaskInput.shape },
    write: true,
    method: "PATCH",
    path: "/tasks/:id",
    run: (db, actor, { id, ...patch }) => updateTask(db, actor, id, patch),
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
    description: "List progress updates, newest first, optionally for one system.",
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
    description: "List open questions, unresolved first, optionally for one system or by resolved state.",
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
```

`matchRoute` in `registry.ts` reads the registry filled by `definitions.ts`; import `@/lib/tools/definitions` (for its side effect) wherever `matchRoute` is used.

- [ ] **Step 5: Run and commit**

```bash
npx vitest run src/lib/tools
git add -A
git commit -m "feat: Add the tool registry shared by MCP and REST"
```

Expected: 5 passed. If typecheck later reports that a `run` input does not match an op's `z.input` type, pass the value through the op's own schema type (for example `input as z.input<typeof createSystemInput>`); do not loosen the op.

---

### Task 5.2: MCP server and route

**Files:**
- Create: `src/lib/mcp/server.ts`, `src/app/api/mcp/route.ts`
- Test: `src/lib/mcp/server.test.ts`

**Interfaces:**
- Consumes: `TOOLS`, `inputSchema`, `runTool` (5.1); `bearerActor` (Part 2).
- Produces: `MCP_INSTRUCTIONS: string`; `createMcpServer(db: Db, actor: Actor): McpServer`; `POST`/`GET`/`DELETE` handlers on `/api/mcp`.

- [ ] **Step 1: Write the failing test**

`src/lib/mcp/server.test.ts`:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { TOOL_NAMES } from "@/lib/tools/definitions";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { createMcpServer } from "./server";

/** Connects an in-memory MCP client to a server acting as `actor`. */
async function connect(db: Db, actor: Actor): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(db, actor).connect(serverSide);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

/** Calls a tool and returns its parsed JSON result and error flag. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError === true, text, json: result.isError ? null : JSON.parse(text) };
}

describe("MCP server", () => {
  it("lists every tool with instructions", async () => {
    const db = await createTestDb();
    const { owner } = await createProjectFixture(db);
    const client = await connect(db, owner);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(client.getInstructions()).toContain("surf-roadmap:plan-system");
  });

  it("runs the whole flow as the key's user with the default agent", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    const client = await connect(db, owner);
    await call(client, "create_system", { project: slug, slug: "shop", title: "Shop" });
    const gated = await call(client, "move_system", { project: slug, system: "shop", column: "Todo" });
    expect(gated.isError).toBe(true);
    expect(gated.text).toContain("System shop is still in planning.");

    const round = await call(client, "add_planning_round", {
      project: slug,
      system: "shop",
      items: (["failure-modes", "dependencies", "scope", "ops-testing"] as const).map((area) => ({ area, question: `${area}?` })),
    });
    await call(client, "answer_planning_items", {
      project: slug,
      system: "shop",
      answers: round.json.itemIds.map((itemId: string) => ({ itemId, answer: "Handled." })),
    });
    await call(client, "write_spec", { project: slug, system: "shop", body: "# Shop" });
    const done = await call(client, "complete_planning", { project: slug, system: "shop", userConfirmation: "Ship it." });
    expect(done.isError).toBe(false);
    const plan = await call(client, "write_plan", { project: slug, system: "shop", body: "## Plan", steps: [{ step: 1, title: "Cart" }] });
    const [taskId] = plan.json.createdTasks;
    await call(client, "update_task", { id: taskId, state: "doing" });
    await call(client, "post_update", { project: slug, system: "shop", taskId, summary: "Cart started", commit: "abc1234" });

    const system = await call(client, "get_system", { project: slug, system: "shop" });
    expect(system.json.tasks[0]).toMatchObject({ state: "doing", ownerName: "Owner" });
    expect(system.json.ownerName).toBe("Owner");
    expect(system.json.updates[0].author).toBe("Claude Code (for Owner)");
  });

  it("returns validation and permission errors as tool errors", async () => {
    const db = await createTestDb();
    const { slug } = await createProjectFixture(db);
    const stranger = (await createProjectFixture(db, "other")).owner;
    const client = await connect(db, stranger);
    const invisible = await call(client, "list_systems", { project: slug });
    expect(invisible).toMatchObject({ isError: true, text: `Unknown project ${slug}.` });
    const invalid = await call(client, "create_project", { slug: "Bad Slug", name: "x" });
    expect(invalid.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/mcp`
Expected: FAIL, `./server` not found.

- [ ] **Step 3: Implement**

`src/lib/mcp/server.ts`:

```ts
import "server-only";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";
import { TOOLS } from "@/lib/tools/definitions";
import { inputSchema, runTool } from "@/lib/tools/registry";

/** Rules the server gives every connecting agent. */
export const MCP_INSTRUCTIONS = [
  "Roadmap with projects, boards (workstreams with custom columns) and systems. Every tool takes the project slug.",
  "1. Every new system goes through the surf-roadmap:plan-system interview: create_system, then for each round add_planning_round BEFORE asking and answer_planning_items right after the user answers, then write_spec, show it, and complete_planning with the user's verbatim confirmation. The server refuses to move a system out of planning, or to start its tasks, before that.",
  "2. Specs, plans, ADRs and open questions live here, never as repository files: write_spec, write_plan, create_adr/accept_adr/supersede_adr, add_question.",
  "3. When you start a task, update_task with state doing (this makes the key's user owner of the task and of an unowned system). After every commit, post_update with the commit hash. When finished, set tasks done and move the system to a review or done column. When stuck, set the task blocked and add_question.",
  "4. Pass agent with your name on writes; it defaults to Claude Code.",
].join("\n");

/** Wraps a tool result, or an error message, as MCP text content. */
async function toResult(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify((await fn()) ?? { ok: true }, null, 2) }] };
  } catch (error) {
    if (statusOf(error) === 500) console.error(error);
    return { content: [{ type: "text", text: messageOf(error) }], isError: true };
  }
}

/**
 * Builds an MCP server exposing every registered tool, acting as `actor`.
 * Write tools default to the agent name "Claude Code".
 */
export function createMcpServer(db: Db, actor: Actor): McpServer {
  const server = new McpServer({ name: "surf-roadmap", version: "1.0.0" }, { instructions: MCP_INSTRUCTIONS });
  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      { description: def.description, inputSchema: inputSchema(def).shape, annotations: { readOnlyHint: !def.write } },
      (args: Record<string, unknown>) => toResult(() => runTool(db, actor, def, args, "Claude Code")),
    );
  }
  return server;
}
```

If the SDK's generic signature rejects the callback's argument type, declare the callback as `(args: unknown) => toResult(() => runTool(db, actor, def, args, "Claude Code"))` and, if still needed, cast the options object with `as Parameters<McpServer["registerTool"]>[1]`. Keep behaviour identical.

`src/app/api/mcp/route.ts`:

```ts
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getDb } from "@/db/client";
import { bearerActor } from "@/lib/auth/actor";
import { createMcpServer } from "@/lib/mcp/server";

/** The endpoint streams and reads the database, so it always runs per request on Node. */
export const dynamic = "force-dynamic";

/**
 * Serves one MCP request statelessly: resolves the API key to an actor, then
 * handles the request with a fresh server and transport.
 *
 * @param request the incoming MCP HTTP request
 */
async function handle(request: Request): Promise<Response> {
  const actor = await bearerActor(request);
  if (!actor) {
    return Response.json({ error: "Missing or invalid API key. Send Authorization: Bearer <ROADMAP_API_KEY>." }, { status: 401 });
  }
  const server = createMcpServer(getDb(), actor);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

/** MCP requests (initialize, tool calls). */
export const POST = handle;

/** MCP server-to-client stream requests. */
export const GET = handle;

/** MCP session termination requests. */
export const DELETE = handle;
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/lib/mcp && npm run typecheck
git add -A
git commit -m "feat: Serve every tool over MCP with API key auth"
```

---

### Task 5.3: REST API and health check

**Files:**
- Create: `src/lib/tools/rest.ts`, `src/app/api/v1/[...path]/route.ts`, `src/app/api/health/route.ts`
- Test: `src/lib/tools/rest.test.ts`

**Interfaces:**
- Produces: `interface RestDeps { db: Db; resolveActor(request: Request): Promise<Actor | null> }`; `coerceQuery(shape: z.ZodRawShape, params: URLSearchParams): Record<string, unknown>`; `handleRest(request: Request, segments: string[], deps: RestDeps): Promise<Response>`; route handlers for every method on `/api/v1/[...path]`; `GET /api/health`.

- [ ] **Step 1: Write the failing test**

`src/lib/tools/rest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";
import { coerceQuery, handleRest } from "./rest";

/** Sends a REST request through the handler as `actor` (or unauthenticated). */
async function send(db: Db, actor: Actor | null, method: string, path: string, body?: unknown) {
  const request = new Request(`http://test/api/v1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const segments = new URL(request.url).pathname.replace(/^\/api\/v1\//, "").split("/");
  const response = await handleRest(request, segments, { db, resolveActor: async () => actor });
  return { status: response.status, json: await response.json() };
}

describe("coerceQuery", () => {
  it("turns true and false into booleans only for boolean inputs", () => {
    const shape = { resolved: z.boolean().optional(), system: z.string().optional() };
    expect(coerceQuery(shape, new URLSearchParams("resolved=false&system=true"))).toEqual({ resolved: false, system: "true" });
  });
});

describe("REST", () => {
  it("serves reads and writes with the documented status codes", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    expect((await send(db, owner, "GET", "/projects")).json.map((p: { slug: string }) => p.slug)).toEqual([slug]);
    expect((await send(db, owner, "POST", `/projects/${slug}/systems`, { slug: "s", title: "S" })).status).toBe(200);
    expect((await send(db, owner, "POST", `/projects/${slug}/systems`, { title: "no slug" })).status).toBe(400);
    const gate = await send(db, owner, "POST", `/projects/${slug}/systems/s/move`, { column: "Todo" });
    expect(gate.status).toBe(409);
    expect(gate.json.error).toContain("still in planning");
    expect((await send(db, owner, "GET", `/projects/${slug}/questions?resolved=false`)).status).toBe(200);
    expect((await send(db, owner, "GET", `/projects/${slug}/updates?limit=5`)).status).toBe(200);
  });

  it("rejects missing keys, unknown routes and invisible projects", async () => {
    const db = await createTestDb();
    const { slug } = await createProjectFixture(db);
    const stranger = (await createProjectFixture(db, "other")).owner;
    expect((await send(db, null, "GET", "/projects")).status).toBe(401);
    expect((await send(db, stranger, "GET", "/nope")).status).toBe(404);
    const hidden = await send(db, stranger, "GET", `/projects/${slug}/systems`);
    expect(hidden).toEqual({ status: 404, json: { error: `Unknown project ${slug}.` } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/tools/rest.test.ts`
Expected: FAIL, `./rest` not found.

- [ ] **Step 3: Implement**

`src/lib/tools/rest.ts`:

```ts
import { z } from "zod";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { messageOf, statusOf } from "@/lib/ops/errors";
import "./definitions";
import { inputSchema, matchRoute, runTool } from "./registry";

/** What the REST handler needs from its environment. */
export interface RestDeps {
  db: Db;
  resolveActor(request: Request): Promise<Actor | null>;
}

/** Returns whether a schema is a boolean, looking through optional, default and nullable wrappers. */
function isBoolean(schema: z.ZodType | undefined): boolean {
  let current: unknown = schema;
  while (current instanceof z.ZodOptional || current instanceof z.ZodDefault || current instanceof z.ZodNullable) {
    current = current.unwrap();
  }
  return current instanceof z.ZodBoolean;
}

/**
 * Converts query parameters into tool input: `true`/`false` become booleans for
 * boolean inputs; everything else stays a string (numbers are coerced by their schemas).
 */
export function coerceQuery(shape: z.ZodRawShape, params: URLSearchParams): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of params) {
    out[key] = isBoolean(shape[key] as z.ZodType | undefined) && (value === "true" || value === "false") ? value === "true" : value;
  }
  return out;
}

/** Reads a JSON object body, or an empty object when there is none or it is not an object. */
async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Handles `/api/v1/<segments>`: finds the tool for the method and path, checks
 * the API key, merges query or body with the path parameters, and runs it.
 * Responds 404 for unknown routes, 401 without a valid key, and the op's status on errors.
 */
export async function handleRest(request: Request, segments: string[], deps: RestDeps): Promise<Response> {
  const method = request.method.toUpperCase();
  const match = matchRoute(method, segments.filter(Boolean));
  if (!match) return Response.json({ error: `No route ${method} /api/v1/${segments.join("/")}.` }, { status: 404 });
  const actor = await deps.resolveActor(request);
  if (!actor) return Response.json({ error: "Missing or invalid API key. Send Authorization: Bearer <key>." }, { status: 401 });
  const raw =
    method === "GET" || method === "DELETE"
      ? coerceQuery(inputSchema(match.def).shape, new URL(request.url).searchParams)
      : await readBody(request);
  try {
    const result = await runTool(deps.db, actor, match.def, { ...raw, ...match.params });
    return Response.json(result ?? { ok: true });
  } catch (error) {
    const status = statusOf(error);
    if (status === 500) console.error(error);
    return Response.json({ error: messageOf(error) }, { status });
  }
}
```

`src/app/api/v1/[...path]/route.ts`:

```ts
import { getDb } from "@/db/client";
import { bearerActor } from "@/lib/auth/actor";
import { handleRest } from "@/lib/tools/rest";

/** Every REST request reads live data. */
export const dynamic = "force-dynamic";

/** Route context with the catch-all path segments. */
interface Context {
  params: Promise<{ path: string[] }>;
}

/** Dispatches a REST request to the tool registry. */
async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return handleRest(request, path, { db: getDb(), resolveActor: bearerActor });
}

/** REST reads. */
export const GET = handle;

/** REST creates and actions. */
export const POST = handle;

/** REST partial updates. */
export const PATCH = handle;

/** REST replacements. */
export const PUT = handle;

/** REST deletions. */
export const DELETE = handle;
```

`src/app/api/health/route.ts`:

```ts
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/** Health checks must hit the database on every call. */
export const dynamic = "force-dynamic";

/** Reports 200 when the database answers, 503 otherwise. Used by the Docker health check. */
export async function GET(): Promise<Response> {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
```

- [ ] **Step 4: Run everything and commit**

```bash
npm test && npm run lint && npm run typecheck && npm run build
git add -A
git commit -m "feat: Add the REST API and health check over the tool registry"
```

- [ ] **Step 5: Smoke test against the running dev server**

With `npm run dev` running and a key created on `/settings/api-keys` (export it as `KEY`):

```bash
curl -s -H "Authorization: Bearer $KEY" http://localhost:3000/api/v1/whoami
curl -s http://localhost:3000/api/health
curl -s -X POST http://localhost:3000/api/mcp -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 300
```

Expected: the whoami JSON with your name, `{"ok":true}`, and a JSON-RPC result listing tools (an `initialize`-first error is also acceptable proof that auth passed; a 401 is a failure).
