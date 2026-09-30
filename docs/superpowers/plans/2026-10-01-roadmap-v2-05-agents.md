# roadmap-app v2 Part 5: Agents, MCP and account security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agents cheaper and easier to see. Batch tools and brief responses cut round trips and context. A trimmed tool list lowers what each session pays up front. OpenAPI documents REST, and an MCP brief resource plus prompts help other clients. Agent runs record every tool call (with token cost from a plugin hook) at no extra model cost. On the account side, people can see key usage, rotate keys, list and end their sessions, and admins get an audit view.

**Architecture:** Every operation stays in the ops layer. The tool registry (`src/lib/tools/*`) gets a `surface` flag, so a few REST-only endpoints (run start and usage) stay out of the MCP tool list. The MCP and REST adapters time each tool call and hand a `CallRecord` to a recorder the route passes in. The Next.js routes persist records with `after()` from `next/server`, which runs once the response has been sent, so recording adds no latency and keeps working while the worker is down. Runs are grouped per API key with a 10-minute idle gap. The plugin's session-start and Stop hooks name runs and report token usage through REST; they run as Node scripts, so they cost the model nothing.

**Tech Stack:** as in the v2 index. Nothing new beyond zod 4's built-in `z.toJSONSchema` and `@modelcontextprotocol/sdk` 1.31's `registerResource` / `registerPrompt` / `ResourceTemplate`.

**Spec:** none for v2. Sources: `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` (shared names, constraints), `docs/superpowers/specs/2026-09-29-roadmap-app-design.md` sections 8–10 (MCP, REST, plugin), and the "Agent runs" proposal of the 2026-09-30 review.

**Assumed from earlier parts:**
- **Part 0:**
  - `get_document` returns `{ document: null, versions: [] }` for a missing document.
  - Lock order is system row, then task row.
  - `updateTask` and `answerQuestion` log nothing when a value does not change.
  - Integer inputs are capped at 2147483647.
- **Part 1:** `registerJob(queue, jobName, handle)` (`src/worker/jobs.ts`), `QUEUE.maintenance`, `WorkerDeps`, `Kv` / `memoryKv()`, and a way to schedule repeatable jobs. Part 1 defines it as `registerRepeatable(queue: QueueName, jobName, schedule: { everyMs: number } | { cron: string }, data?)`; the job must also be registered with `registerJob`.
- **Part 2:** `updateTaskInput` gains `notes`, `blockedReason`, `estimate`; the batch tool reuses it unchanged.

If a name differs in the code you find, use the code's name and note it in the commit body.

## Global Constraints

- Everything in the v2 index Global Constraints applies, in particular the ops-layer rule, adapters, change-log vocabulary, migrations, tests without Valkey, commit format with the `Co-Authored-By` trailer, and the agent token budget.
- **Tool descriptions:** one or two sentences, at most 200 characters, and no examples that repeat what the schema already says. Field `.describe()` texts: at most 80 characters.
- **Batch limit:** batch tools accept 1 to 50 items per call.
- **Run grouping:** an API key's tool calls belong to its latest `agent_run` while that run's `lastCallAt` is less than 10 minutes old; otherwise a new run starts. A run counts as live when its `lastCallAt` is less than 2 minutes old.
- **Retention:** `agent_call` and `agent_run` rows are kept for 30 days, `auth_event` rows for 90 days.
- **Recording never breaks a call:** a recorder error is logged with `console.error` and swallowed. The tool's response is unchanged.
- **New change-log entity:** none. Agent runs, calls and auth events are telemetry, not project content, and are never written to `change_log`.
- **Privacy:** `agent_call` stores the tool name, project slug, system slug and a short target (for example `task #188`), never tool inputs or outputs. Error messages are truncated to 300 characters.

## Review Focus

1. **An agent retries `add_tasks` after a timeout with the same `clientRef`s:** no duplicate tasks. The response lists the existing tasks with `created: false`. Pinned in Task 1 (idempotent retry test).
2. **A batch where one item is invalid** (unknown task id, a task in a project the key cannot edit, planning incomplete for `doing`): nothing in the batch is applied, and the error names the failing item's index. Pinned in Task 1 (all-or-nothing tests).
3. **The recorder or database fails while recording a call:** the tool answer the agent receives is unchanged. Pinned in Task 5 (throwing recorder test).
4. **Two tool calls from one key arrive at the same moment at the start of a session:** both land in one run, not two. Pinned in Task 5 (concurrent grouping test using an advisory lock).
5. **The Stop hook gets a missing, huge or malformed transcript, or the roadmap is unreachable:** the hook exits 0 with no output within its timeout, and the user's session is never blocked. Pinned in Task 6 (hook tests).

---

### Task 1: Batch tools with idempotent `clientRef`

**Files:**
- Modify: `src/db/schema/content.ts` (task table)
- Create: migration via `npm run db:generate -- --name task-client-ref`
- Modify: `src/lib/ops/tasks.ts`, `src/lib/ops/questions.ts`
- Create: `src/lib/ops/batch.ts`
- Modify: `src/lib/tools/definitions.ts`
- Modify: `plugin/skills/track-work/SKILL.md`, `plugin/skills/write-plan/SKILL.md` and any other `plugin/**` file that names `add_task` (grep first)
- Test: `src/lib/ops/batch.test.ts`, `src/lib/tools/registry.test.ts`

**Interfaces:**
- Consumes: `addTaskInput`, `updateTaskInput`, `answerQuestionInput`, `taskAccess` (internal), `findQuestion` (internal), `logChange`.
- Produces:
  - `task.clientRef: text("client_ref")`, nullable, with unique index `task_client_ref` on `(system_id, client_ref)`.
  - `addTasksInput = z.object({ tasks: z.array(addTaskInput.extend({ clientRef: z.string().trim().min(1).max(64).optional() })).min(1).max(50) })`.
  - `addTasks(db, actor, projectSlug, systemSlug, raw): Promise<{ tasks: { id: number; title: string; clientRef: string | null; created: boolean }[] }>`.
  - `updateTasksInput = z.object({ updates: z.array(z.object({ id: <int 1..2147483647>, ...updateTaskInput.shape })).min(1).max(50) })`.
  - `updateTasks(db, actor, raw): Promise<{ tasks: TaskRow[] }>`.
  - `answerQuestionsInput = z.object({ answers: z.array(answerQuestionInput).min(1).max(50) })`.
  - `answerQuestions(db, actor, projectSlug, raw): Promise<{ questions: QuestionItem[] }>`.
  - Exported transaction-level helpers the batch ops reuse: `addTaskInTx(tx, actor, system, input)`, `updateTaskInTx(tx, actor, taskId, patch)`, `answerQuestionInTx(tx, actor, project, input)`. The existing single ops call these inside their own transaction, so behaviour stays identical.
  - Tools: `add_tasks` (replaces `add_task`, same REST path `POST /projects/:project/systems/:system/tasks`, body `{ tasks: [...] }`), `update_tasks` (`PATCH /tasks`), `answer_questions` (`POST /projects/:project/questions/answers`). `update_task` and `answer_question` stay.

- [ ] **Step 1: Write the failing tests** in `src/lib/ops/batch.test.ts`. Use `createProjectFixture`, `createSystem`, `completePlanningFixture`, `addMemberFixture`. Cases:
  - `addTasks` with `[{title:"A", clientRef:"s1"}, {title:"B", clientRef:"s2"}]` returns two tasks with `created: true`, in input order, with consecutive `sortOrder`.
  - The same call again returns the same two ids with `created: false`, and the system still has exactly 2 tasks.
  - A retry `[{title:"A", clientRef:"s1"}, {title:"C", clientRef:"s3"}]` gives s1 `created: false` (same id) and s3 `created: true`; the system has 3 tasks. A different title under an existing `clientRef` keeps the stored title and does not rename it.
  - Items without `clientRef` always create.
  - `updateTasks` with `[{id: t1, state:"done"}, {id: 999999, state:"done"}]` throws `NotFoundError` whose message starts with `Item 2:`, and t1 is still `todo` (all-or-nothing).
  - `updateTasks` setting `doing` on a task of a system whose planning is incomplete throws `ConflictError` with `Item 1:`, and nothing changes.
  - `updateTasks` on tasks of two systems in the same project succeeds, and each change appears once in `change_log`.
  - A viewer calling `addTasks` gets `ForbiddenError`, and no row is written.
  - `answerQuestions` with two open questions resolves both. If one id is unknown, neither is answered.
  - Input with 51 items fails zod validation (400).
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/batch.test.ts`. Expected: FAIL, `addTasks` is not exported.
- [ ] **Step 3: Implement.**
  - **Schema:** add `clientRef` and the unique index (`uniqueIndex("task_client_ref").on(t.systemId, t.clientRef)`; Postgres treats NULLs as distinct, so tasks without a ref never collide). Generate the migration.
  - **Refactor:** split `addTask`, `updateTask` and `answerQuestion` into `…InTx` helpers plus thin wrappers that open the transaction. Keep the lock order from Part 0: system row first, then task row.
  - **`addTasks`:** one transaction.
    1. Resolve access (editor) and lock the system row once.
    2. Read existing tasks with those clientRefs: `select … where system_id = ? and client_ref = any(?)`.
    3. For each item, return the existing task (`created: false`) or insert via `addTaskInTx` with the clientRef.
    4. A unique violation still possible under a race (a concurrent call that doesn't hold the lock) is impossible, because the system row lock serialises the calls; add a comment saying so.
  - **`updateTasks`:** one transaction. Load the task rows (unlocked) to learn their system ids. Lock those system rows in ascending id order, then run `updateTaskInTx` per item in input order. Wrap each item's error: catch `OpError`, rethrow the same class with the message prefixed `Item <n>: ` (1-based), and let the transaction roll back.
  - **`answerQuestions`:** the same pattern, locking question rows in ascending id order.
  - **Tools:** replace `add_task` with `add_tasks`, and add `update_tasks` and `answer_questions`. Descriptions:
    - `add_tasks`: "Add up to 50 tasks to a system in one call. Pass a clientRef per task so a retried call returns the same tasks instead of adding them twice."
    - `update_tasks`: "Change up to 50 tasks in one call, same fields as update_task. All changes apply or none do."
    - `answer_questions`: "Answer up to 50 questions in one call; each resolves unless resolved is false. All apply or none do."
- [ ] **Step 4: Update the plugin.** Wherever a skill tells the agent to add several tasks or answer several questions (grep `add_task`, `answer_question` in `plugin/`), switch to the batch tool, with `clientRef` set to `step-<n>` or a short stable slug. Keep `update_task` for single state changes.
- [ ] **Step 5: Run** `npx vitest run src/lib/ops src/lib/tools` and `npm run test:plugin`. Expected: PASS. Update `src/lib/tools/registry.test.ts` and `src/app/api/mcp/route.test.ts` wherever they list `add_task`.
- [ ] **Step 6: Commit** `feat(tools): add batch task and question tools with idempotent client refs`.

### Task 2: Brief responses

**Files:**
- Create: `src/lib/tools/brief.ts`
- Modify: `src/lib/tools/definitions.ts`, `src/lib/mcp/server.ts` (`MCP_INSTRUCTIONS`)
- Modify: `plugin/skills/write-plan/SKILL.md`, `plugin/agents/plan-checker.md`, `plugin/skills/plan-system/SKILL.md`, and every other plugin file that reads a spec or plan body from `get_system` (grep `get_system` and read each use)
- Test: `src/lib/tools/brief.test.ts`

**Interfaces:**
- Consumes: `SystemOverview` (`src/lib/ops/overview.ts`), `AdrSummary`, the `listActivity` row type.
- Produces:
  - `const BRIEF = { brief: z.boolean().optional().describe("Leave out long bodies (default true). Pass false for full text.") }`.
  - `briefOverview(o: SystemOverview): BriefSystemOverview`:
    - `spec` and `plan` become `DocumentMeta | null`, where `DocumentMeta = { version: number; createdAt: Date; authorName: string; agent: string | null; chars: number }`.
    - `updates` are cut to the newest 3, each `{ id, createdAt, authorName, agent, summary }`.
    - Every other field stays.
  - `briefAdrs(rows: AdrSummary[])`: each row reduced to `{ number, title, status, systems, supersededBy }`.
  - `briefActivity(rows)`: `oldValue` and `newValue` truncated to 120 characters, with `…` appended when cut.
  - `get_system`, `list_adrs` and `list_activity` gain `brief`, which defaults to `true`. `get_document`, `get_planning` and `get_adr` are unchanged: they exist to return full text.

- [ ] **Step 1: Write the failing tests** in `src/lib/tools/brief.test.ts`:
  - **`briefOverview`:** an overview whose spec body is 5 000 characters returns `spec.chars === 5000` and no `body` key. `plan: null` stays `null`. With 10 updates, it keeps the 3 newest in order.
  - **`briefActivity`:** a 300-character `newValue` becomes 121 characters ending in `…`, and a 50-character one is unchanged.
  - **Through `runTool`** (the `get_system` definition): the default call has no `spec.body`, and `brief: false` includes `spec.body`.
  - **REST:** `GET /projects/demo/systems/x?brief=false` coerces the string to the boolean (use `handleRest` with a fake `resolveActor`, as `rest.test.ts` does).
- [ ] **Step 2: Run** `npx vitest run src/lib/tools/brief.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `brief.ts`. Wire `brief` into the three tools: `run` calls the op, then applies the brief mapper unless `brief === false`. Update their descriptions to mention it in a few words, for example "…; brief by default, use get_document for spec and plan text."
- [ ] **Step 4: Update the plugin.**
  - **`write-plan`:** stays on `get_system` for preconditions, but the header must name the spec via `get_document` (`kind: "spec"`).
  - **`plan-checker` and every skill or agent that needs spec or plan text:** load it with `get_document`.
  - **`MCP_INSTRUCTIONS`:** add one sentence: "get_system, list_adrs and list_activity are brief by default; use get_document or get_adr for full text."
  - Keep every plugin text change minimal.
- [ ] **Step 5: Run** `npx vitest run src/lib/tools` and `npm run test:plugin`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(tools): return brief system, ADR and activity responses by default`.

### Task 3: Smaller tool list with a size budget

**Files:**
- Create: `src/lib/mcp/tool-list.ts`
- Modify: `src/lib/tools/definitions.ts` (descriptions only), `src/lib/mcp/server.ts`
- Test: `src/lib/mcp/tool-list.test.ts`

**Interfaces:**
- Consumes: `TOOLS`, `inputSchema`, `MCP_INSTRUCTIONS`.
- Produces:
  - `toolListPayload(): { name: string; description: string; inputSchema: unknown }[]`, built the way MCP `tools/list` serialises tools, with `z.toJSONSchema(inputSchema(def), { io: "input", unrepresentable: "any" })`. Tools whose `surface` is `"rest"` (Task 5) are left out; until Task 5 exists, every tool is included.
  - `toolListBytes(): number`: `Buffer.byteLength(JSON.stringify(toolListPayload())) + Buffer.byteLength(MCP_INSTRUCTIONS)`.
  - `TOOL_LIST_BUDGET_BYTES`: a constant exported from `tool-list.ts`.

- [ ] **Step 1: Measure.** Write a scratch vitest test that prints `toolListBytes()` and each tool's share, largest first. Run it and note the numbers in the commit body as "before".
- [ ] **Step 2: Write the failing test** in `tool-list.test.ts`:
  - `toolListBytes() <= TOOL_LIST_BUDGET_BYTES`.
  - Every description is at most 200 characters.
  - Every `.describe()` text found in the JSON schemas (walk the `description` keys) is at most 80 characters.
  - Set the constant to 80 % of the measured "before" value, rounded down to a multiple of 256, so the test fails until the text is trimmed.
- [ ] **Step 3: Trim.**
  - Shorten tool and field descriptions: drop phrases the schema already says (enum values, "optional", id sources that the field name makes clear). Keep every rule that changes agent behaviour (planning gate, accepted ADRs immutable, doing claims ownership, verbatim confirmation).
  - Move rules that several tools repeat into `MCP_INSTRUCTIONS` once.
  - Iterate until the test passes. Then lower `TOOL_LIST_BUDGET_BYTES` to the new measured size rounded up to the next multiple of 256, so future growth has to be deliberate.
  - Add a doc comment on the constant: "Raise only with a reason in the commit message."
- [ ] **Step 4: Run** `npx vitest run src/lib/mcp src/lib/tools` and `npm run test:plugin`. Expected: PASS.
- [ ] **Step 5: Commit** `perf(mcp): trim tool descriptions under a tool list size budget`. The body records the before and after byte counts.

### Task 4: OpenAPI document and API docs page

**Files:**
- Create: `src/lib/tools/openapi.ts`, `src/app/api/v1/openapi.json/route.ts`, `src/app/api/docs/route.ts`, `src/lib/tools/docs-html.ts`
- Modify: `src/proxy.ts` (nothing to change, since `api/` is already excluded; confirm), `README.md` (Agents section: link `/api/docs`)
- Test: `src/lib/tools/openapi.test.ts`

**Interfaces:**
- Consumes: `registeredTools()`, `inputSchema`, `ToolDef`.
- Produces:
  - `buildOpenApi(tools: readonly ToolDef[], serverUrl: string): OpenApiDocument` (OpenAPI 3.1.0).
    - One operation per tool, with `operationId` set to the tool name.
    - Paths turn `:param` into `{param}`, with path parameters `required: true`.
    - GET and DELETE tools turn the remaining shape keys into query parameters. Other methods get a JSON `requestBody` whose schema is the input schema without the path keys.
    - `tags: [<first path segment after /projects/:project, or the first segment>]`.
    - Responses: `200` (description "Result"), and `400`, `401`, `403`, `404`, `409`, `429`, each with schema `{ error: string }`.
    - `components.securitySchemes.bearer = { type: "http", scheme: "bearer" }`, applied globally.
  - `renderDocsHtml(doc: OpenApiDocument): string`: a self-contained HTML page (inline CSS, no external scripts or fonts, light and dark via `prefers-color-scheme`) that lists operations grouped by tag. Each shows its method, path, description, and a parameter table (name, in, type, required, description).
  - `GET /api/v1/openapi.json` returns the document with `cache-control: public, max-age=300`. `GET /api/docs` returns the HTML. Both are unauthenticated, since the document holds no secrets.

- [ ] **Step 1: Write the failing tests** in `openapi.test.ts`:
  - Every registered tool appears exactly once by `operationId`.
  - `get_system` lives at `/projects/{project}/systems/{system}` with two required path parameters and a boolean `brief` query parameter.
  - `add_tasks` has a request body whose schema has required `tasks` and no `project` property.
  - The document passes a structural check: `openapi === "3.1.0"` and every `$ref` resolves (walk the tree).
  - `renderDocsHtml` output contains `id="op-get_system"` and escapes a description containing `<script>` (assert `&lt;script&gt;`).
  - `z.toJSONSchema` of a `positiveInt` (a preprocess schema) yields `{ type: "integer", minimum: 1 }` or a permissive schema, never a thrown error. If zod throws for preprocess, add an `override` callback that maps preprocess to its inner output schema.
- [ ] **Step 2: Run** `npx vitest run src/lib/tools/openapi.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules and routes. `serverUrl` comes from `siteUrl()` (`src/lib/site.ts`) plus `/api/v1`. The static `openapi.json` folder takes precedence over the `[...path]` catch-all; verify with a request in the dev server.
- [ ] **Step 4: Run** `npx vitest run src/lib/tools`, then `npm run build`. Expected: PASS; the build lists `/api/docs` and `/api/v1/openapi.json`.
- [ ] **Step 5: Commit** `feat(api): serve an OpenAPI document and API docs page generated from the tools`.

### Task 5: Record agent calls and group them into runs

**Files:**
- Modify: `src/db/schema/` (new file `src/db/schema/agents.ts`, exported from `index.ts`)
- Create: migration via `npm run db:generate -- --name agent-runs`
- Create: `src/lib/ops/agent-runs.ts`
- Modify: `src/lib/tools/registry.ts` (add `surface`), `src/lib/tools/rest.ts`, `src/lib/mcp/server.ts`, `src/app/api/mcp/route.ts`, `src/app/api/v1/[...path]/route.ts`, `src/lib/auth/actor.ts`, `src/lib/tools/definitions.ts`
- Test: `src/lib/ops/agent-runs.test.ts`, `src/lib/tools/rest.test.ts`, `src/lib/mcp/server.test.ts`

**Interfaces:**
- Consumes: `bearerActor`, `runTool`, `withAgent`.
- Produces:
  - Table `agent_run`:
    - identity: `id` text pk (`newId()`), `apiKeyId` text not null (no FK: runs outlive revoked keys), `userId` text not null FK `user.id` on delete cascade.
    - naming: `title` text null, `repo` text null, `branch` text null, `clientSessionId` text null (the Claude Code `session_id`).
    - timing: `startedAt` timestamptz not null default now, `lastCallAt` timestamptz not null default now.
    - counters: `callCount` int not null default 0, `errorCount` int not null default 0.
    - tokens: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, all bigint mode number, null.
    - indexes: `(api_key_id, last_call_at desc)`, `(user_id, last_call_at desc)`, unique `(client_session_id)` where not null.
  - Table `agent_call`:
    - columns: `id` bigserial pk, `runId` text not null FK `agent_run.id` cascade, `at` timestamptz not null, `tool` text not null, `transport` text enum `mcp | rest` not null, `agent` text null (the actor's agent label, e.g. "Claude Code"), `projectId` text null FK `project.id` on delete set null, `systemSlug` text null, `target` text null, `ok` boolean not null, `status` int not null, `error` text null, `durationMs` int not null.
    - indexes: `(run_id, id)`, `(project_id, at desc)`, `(at)`.
  - `CallRecord = { apiKeyId: string; userId: string; agent: string | null; tool: string; transport: "mcp" | "rest"; input: Record<string, unknown>; ok: boolean; status: number; error: string | null; durationMs: number; at: Date }`.
  - `recordCall(db, record: CallRecord): Promise<void>`.
    - In one transaction, takes `pg_advisory_xact_lock(hashtext(apiKeyId))`, finds or creates the run under the 10-minute rule, and inserts the call.
    - `projectId` is resolved from `input.project` (slug lookup; null when unknown), `systemSlug` from `input.system`, and `target` from `callTarget(tool, input)`.
    - Increments `callCount`, increments `errorCount` when not ok, and sets `lastCallAt = at`.
  - `callTarget(tool, input): string | null`, a pure function:
    - `task #<id>` for `update_task`, `<n> tasks` for batch tools
    - `ADR <number>` for ADR tools
    - `<kind> v<version>` for `get_document`
    - otherwise the system slug or null
  - `startRun(db, actor, apiKeyId, input: { title?: string; repo?: string; branch?: string; clientSessionId?: string }): Promise<{ runId: string }>`: closes nothing. It creates a new run whose `lastCallAt` is now, so that the key's next calls join it. If `clientSessionId` already exists, it returns that run and updates its title fields.
  - `recordUsage(db, actor, apiKeyId, input: { clientSessionId: string; inputTokens; outputTokens; cacheReadTokens; cacheWriteTokens }): Promise<void>`: sets totals (not increments) on the run with that session id owned by the actor. An unknown session creates a run for the key with those totals (a Stop hook without a session-start).
  - `bearerAuth(request): Promise<{ actor: Actor; apiKeyId: string } | null>` in `src/lib/auth/actor.ts`. `bearerActor` becomes a wrapper returning `.actor`.
  - `ToolDef.surface?: "all" | "rest"` (default `"all"`). `createMcpServer` skips `"rest"` tools. `ToolDef.run` gains an optional 4th parameter `ctx: { apiKeyId: string | null }`, passed by `runTool` as its new last parameter.
  - `RestDeps` changes to `{ db; resolveAuth(request): Promise<{ actor: Actor; apiKeyId: string } | null>; recordCall?: (r: CallRecord) => void }`. `createMcpServer(db, actor, opts?: { apiKeyId?: string; recordCall?: (r: CallRecord) => void })`.
  - REST-only tools:
    - `start_agent_run`: `POST /agent-runs`, input `{ title?: max 120, repo?: max 200, branch?: max 200, clientSessionId?: max 100 }`.
    - `report_agent_usage`: `POST /agent-runs/usage`, input `{ clientSessionId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }`, all non-negative ints up to 2^53−1.
    - Both have `write: false`, since they don't change project content, and neither is recorded as a call itself.

- [ ] **Step 1: Write the failing tests** in `src/lib/ops/agent-runs.test.ts`:
  - **Grouping:**
    - Three `recordCall`s for key K at t, t+5 min and t+9 min land in one run with `callCount 3`.
    - A fourth at t+20 min starts run 2.
    - Key L's calls never join K's run.
  - **Concurrent grouping:** two `recordCall`s for a fresh key started with `Promise.all` produce exactly one run with `callCount 2` (Review Focus 4).
  - **Errors:** an `ok: false` call with a 400-character error stores 300 characters and increments `errorCount`.
  - **Project lookup:** `input.project` naming a nonexistent slug stores `projectId: null` without throwing.
  - **`callTarget`:** `("update_task", {id: 188})` gives `"task #188"`, `("add_tasks", {tasks:[{},{}]})` gives `"2 tasks"`, and `("get_document", {kind:"plan", version: 3})` gives `"plan v3"`.
  - **`startRun` then `recordCall`:** the call joins the started run and the run keeps its title. `startRun` twice with the same `clientSessionId` returns the same run id.
  - **`recordUsage`:** sets totals, and calling it again with larger totals replaces them, it doesn't add. A session id owned by another user throws `NotFoundError`.
- [ ] **Step 2: Write the adapter tests.**
  - **REST** (`rest.test.ts`):
    - A recorder spy receives one record with `transport: "rest"`, `ok: true`, `status: 200` and a numeric `durationMs`.
    - A failing tool records `ok: false` with its status.
    - A recorder that throws does not change the 200 response (Review Focus 3).
    - `POST /agent-runs` without a key returns 401.
  - **MCP** (`server.test.ts`):
    - `tools/list` does not contain `start_agent_run`.
    - A tool call reaches the recorder with `transport: "mcp"`.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/agent-runs.test.ts src/lib/tools src/lib/mcp`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Schema, migration and ops.
  - **`bearerAuth`:** `verifyApiKey` already returns `result.key.id`.
  - **REST and MCP adapters:** time each call with `performance.now()` around `runTool` and build the `CallRecord`. Wrap `deps.recordCall` in try/catch with `console.error`.
  - **Routes:** pass `recordCall: (r) => after(() => recordCall(getDb(), r).catch((e) => console.error(e)))`, using `after` from `next/server`.
  - Put a comment on the route recorder: recording runs after the response, so agents never wait for it, and it doesn't depend on the worker, so runs keep recording while Valkey or the worker is down.
  - Skip recording for the two REST-only run tools.
- [ ] **Step 5: Run** the same tests, then `npm test`. Expected: PASS. Update `tool-list.test.ts` if the budget moved: REST-only tools are excluded from the MCP payload.
- [ ] **Step 6: Commit** `feat(agents): record MCP and REST tool calls into agent runs`.

### Task 6: Plugin hooks name runs and report token usage

**Files:**
- Modify: `plugin/hooks/session-start.mjs`, `plugin/hooks/lib.mjs`, `plugin/hooks/hooks.json`
- Create: `plugin/hooks/stop.mjs`
- Test: `plugin/hooks/hooks.test.mjs`

**Interfaces:**
- Consumes: REST `POST /api/v1/agent-runs` and `POST /api/v1/agent-runs/usage` (Task 5); hook input fields `session_id`, `transcript_path`, `cwd`.
- Produces:
  - `gitInfo(cwd): { repo: string | null; branch: string | null }` in `lib.mjs`. It runs `git -C <cwd> remote get-url origin` (reduced to `owner/name`) and `git -C <cwd> rev-parse --abbrev-ref HEAD` with `execFileSync`, a 1 s timeout and stdio ignored. Any failure gives null.
  - `sumTranscriptUsage(path, maxBytes = 50 * 1024 * 1024): { inputTokens; outputTokens; cacheReadTokens; cacheWriteTokens } | null`.
    - Reads the JSONL line by line and returns null when the file is missing or bigger than `maxBytes`.
    - For entries with `type === "assistant"` and a `message.usage`, it counts each `message.id` once (the last occurrence wins, because streamed entries repeat).
    - It sums `input_tokens`, `output_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`, and skips malformed lines.
  - `postJson(path, body, timeoutMs)`: shared helper for both hooks, using `ROADMAP_URL` and `ROADMAP_API_KEY`. It resolves false on any failure and never throws.
  - Session start, in linked repositories only, after `whoami` succeeds: `POST /agent-runs` with `{ title: "<repo> · <branch>", repo, branch, clientSessionId: session_id }`, timeout 2 s, fire and await with a catch.
  - `stop.mjs`: in linked repositories only, `sumTranscriptUsage(transcript_path)` and then, when non-null, `POST /agent-runs/usage`. Timeout 3 s; exit 0 always; print nothing.
  - `hooks.json`: add `"Stop": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/stop.mjs\"", "timeout": 5 }] }]`.

- [ ] **Step 1: Write the failing tests** in `hooks.test.mjs` (node:test, patterns as in the existing file):
  - **`sumTranscriptUsage`**, on a temp JSONL with two assistant entries sharing `message.id` "m1" (usage 10/5, then 12/6) and one "m2" (usage 3/1, cache read 100): returns `{ inputTokens: 15, outputTokens: 7, cacheReadTokens: 100, cacheWriteTokens: 0 }`.
  - **Malformed lines and missing file:** a file with a garbage line in between gives the same result. A missing path gives null. A file bigger than `maxBytes` (pass a small `maxBytes` in the test) gives null.
  - **`gitInfo`:** in a temp non-git directory returns both null.
  - **`stop.mjs` exit behaviour:** run via `spawnSync` with malformed stdin, with a nonexistent `transcript_path`, and with `ROADMAP_URL` pointing at a closed port (`http://127.0.0.1:9`). Each exits 0 with empty stdout within 5 s (Review Focus 5).
  - **`stop.mjs` in a non-linked cwd:** exits 0, prints nothing, makes no request. Assert with a local `http.createServer` that counts requests.
  - **`session-start.mjs` in a linked repo** against a local HTTP server that answers `/api/v1/whoami` with `{"name":"Ammo"}`: the server receives a `POST /api/v1/agent-runs` whose body has `clientSessionId` equal to the stdin `session_id`.
- [ ] **Step 2: Run** `npm run test:plugin`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers and `stop.mjs`, and extend session start. Keep the whole session-start body inside the existing try/catch.
- [ ] **Step 4: Run** `npm run test:plugin`. Expected: PASS. Bump `plugin/.claude-plugin/plugin.json` `version` to `1.1.0`.
- [ ] **Step 5: Commit** `feat(plugin): name agent runs at session start and report token usage on stop`.

### Task 7: Agents page and cost per system

**Files:**
- Create: `src/server/trpc/routers/agents.ts` (register as `agents` in `src/server/trpc/router.ts`)
- Modify: `src/lib/ops/agent-runs.ts`
- Create: `src/app/(app)/p/[project]/agents/page.tsx`, `src/app/(app)/p/[project]/agents/agents-view.tsx`, `src/components/agents/run-list.tsx`, `src/components/agents/run-timeline.tsx`
- Modify: `src/components/shell/app-sidebar.tsx` (nav item "Agents" with a live count), `src/lib/ops/summaries.ts` (`projectNav` gains `liveRuns: number`), the system page overview (`src/app/(app)/p/[project]/systems/[system]/system-view.tsx`: an "Agent cost" fact)
- Test: `src/lib/ops/agent-runs.test.ts`, `src/server/trpc/router.test.ts`

**Interfaces:**
- Consumes: `projectAccess`, tables from Task 5.
- Produces:
  - `listProjectRuns(db, actor, slug, filter: { state?: "live" | "recent" | "failed"; limit?: number }): Promise<RunSummary[]>`.
    - Includes runs with at least one call in that project; needs viewer access.
    - `live` means `lastCallAt` within 2 minutes; `recent` means the last 24 hours; `failed` means `errorCount > 0` within 7 days.
    - Newest first; default limit 50.
  - `RunSummary = { id; title; repo; branch; userId; userName; startedAt; lastCallAt; callCount; errorCount; live: boolean; tokens: { input; output; cacheRead; cacheWrite } | null }`.
  - `getRun(db, actor, slug, runId): Promise<{ run: RunSummary; calls: CallRow[]; changes: ActivityRow[] }>`.
    - `calls` are that run's calls in this project, in time order.
    - `changes` are change-log rows of the project by `run.userId` with non-null `agent`, between `startedAt` and `lastCallAt` plus 5 s. These are shown as "What changed".
    - A run with no call in the project gives `NotFoundError`.
  - `systemAgentCost(db, actor, projectSlug, systemSlug): Promise<{ runs: number; tokens: number } | null>`.
    - For each run with calls on that system, it attributes the run's total tokens (input + output + cache write, excluding cache reads, which are cheap and would dominate) in proportion to that system's share of the run's calls, then rounds.
    - Returns null when no run has token data.
  - tRPC `agents.runs({ project, state })`, `agents.run({ project, runId })`, `agents.systemCost({ project, system })`.

- [ ] **Step 1: Write the failing tests:**
  - **`live` filter:** with fixed `at` values, a run whose last call was 1 minute ago is live; one 5 minutes ago is not live but is in `recent`.
  - **Access:** a non-member gets `NotFoundError` for `listProjectRuns`.
  - **`systemAgentCost`:** a run with 1 000 tokens and 4 calls, 3 on system A and 1 on B, gives A 750 and B 250. A run without tokens is left out.
  - **`getRun` changes:** returns only the change rows inside the time window.
  - **Router:** `agents.runs` as a viewer succeeds.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the ops, router and UI.
  - **Agents page:** a segmented control (Live / Today / Failed) with counts, bound to the `state` search param. The run list shows avatar, title (or "Untitled run"), user, call count, error count, duration, a live dot, and tokens formatted with `Intl.NumberFormat` compact notation.
  - **Run detail:** a `Sheet` opened by `?run=<id>` shows the call timeline (time `HH:mm:ss`, tool in mono, target, duration ms, and a coloured dot: read, write, or error with the error message) and the "What changed" list linking to the activity entries.
  - **Refresh:** `refetchInterval: 15_000` while the Live tab is open. Part 9 replaces this with SSE.
  - **Empty state:** "No agent runs yet. Runs appear here when someone's agent calls the roadmap with an API key."
  - **System page:** an "Agent cost" fact such as "1.2M tokens · 4 runs" linking to the Agents page, shown only when non-null.
  - Match the Tide design of the existing pages.
- [ ] **Step 4: Run** `npm test`, then `npm run build`. Check the page in the dev server with seeded data (`npm run db:seed`, then run two REST calls with an API key).
- [ ] **Step 5: Commit** `feat(agents): add the agents page with run timelines and cost per system`.

### Task 8: MCP brief resource and prompts

**Files:**
- Create: `src/lib/ops/brief.ts`, `src/lib/mcp/prompts.ts`
- Modify: `src/lib/mcp/server.ts`
- Test: `src/lib/ops/brief.test.ts`, `src/lib/mcp/server.test.ts`

**Interfaces:**
- Consumes: `listPhases`, `listSystems`, `listQuestions`, `listAdrs`, `listProjects`.
- Produces:
  - `projectBrief(db, actor, slug): Promise<string>`: markdown of at most 4 000 characters.
    - Heading `# <name> (<slug>)` and the description's first line.
    - `## Phases`: each phase with done/total systems.
    - `## Active`: systems in `active` or `review` columns, as `- <title> (<slug>) · <column> · <owner or unowned> · <open tasks> open`, at most 15.
    - `## Blocked`: the same format.
    - `## Open questions`: count plus the 5 oldest, as `- Q<id>: <text cut to 100>`.
    - `## Proposed decisions`: `- ADR-<nnnn> <title>`.
    - When the brief exceeds 4 000 characters, the longest lists are cut with `- …and N more`.
  - MCP resource `project-brief`, `new ResourceTemplate("roadmap://project/{slug}/brief", { list })`.
    - `list` returns one resource per project the actor can see: name `<project name> brief`, mimeType `text/markdown`.
    - Read returns `projectBrief`.
  - `MCP_PROMPTS: { name: "next" | "status" | "plan"; description: string; args: z.ZodRawShape; text(args): string }[]` in `prompts.ts`.
    - `next(project)`: the `plugin/commands/next.md` procedure, rewritten for any MCP client.
    - `status(project)`: the procedure of `plugin/commands/status.md`.
    - `plan(project, system?)`: "Run the planning interview" steps from the plan-system skill: create_system, rounds before asking, answer right after, write_spec, confirm, complete_planning. Condensed to at most 1 500 characters.
    - Registered with `server.registerPrompt(name, { description, argsSchema }, (args) => ({ messages: [{ role: "user", content: { type: "text", text } }] }))`.

- [ ] **Step 1: Write the failing tests:**
  - **`projectBrief`:** on a fixture with 20 active systems, the output is at most 4 000 characters and contains `…and`. It lists a blocked system under `## Blocked`, and a non-member gets `NotFoundError`.
  - **MCP resources** (`server.test.ts`, with the SDK's in-memory client transport pair `InMemoryTransport.createLinkedPair()`):
    - `resources/templates/list` includes `roadmap://project/{slug}/brief`.
    - `resources/list` returns the actor's projects only.
    - `resources/read` of `roadmap://project/demo/brief` starts with `# DEMO (demo)`.
  - **MCP prompts:**
    - `prompts/list` returns exactly `next`, `status` and `plan`.
    - `prompts/get` of `plan` with `{project:"demo", system:"search"}` contains `add_planning_round`.
    - Every tool name that appears in any prompt text is a registered tool (regex `\b[a-z]+(?:_[a-z]+)+\b` matched against `TOOL_NAMES`).
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Read the exact `registerResource` / `registerPrompt` signatures in `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` (1.31.0) before writing. Errors inside the resource read (for example, an invisible project) become an MCP error through the SDK, not a crash.
- [ ] **Step 4: Run** `npx vitest run src/lib/mcp src/lib/ops/brief.test.ts`. Expected: PASS. Confirm `tool-list.test.ts` still passes: prompts and resources are not in the tool list.
- [ ] **Step 5: Commit** `feat(mcp): add a project brief resource and next, status and plan prompts`.

### Task 9: Rules for other agents (AGENTS.md and Cursor rules)

**Files:**
- Modify: `plugin/scripts/lib.mjs`, `plugin/scripts/surf-roadmap.mjs`, `plugin/skills/setup/SKILL.md`
- Create: `plugin/conventions/other-agents/header.md` (the roadmap rules phrased for agents without the plugin: which MCP server to add and how, that specs, plans and ADRs live in the roadmap, and the track-work rules)
- Test: `plugin/scripts/scripts.test.mjs`

**Interfaces:**
- Consumes: `loadConventions`, `expectedBlocks`, `planClaudeMd` (the same marked-section approach).
- Produces:
  - `renderOtherAgents(conv, answers, link): { agentsMd: string; cursorRule: string }`.
    - `agentsMd` holds the header block plus the same convention blocks `expectedBlocks` selects for CLAUDE.md, each in the same `<!-- surf-roadmap:<id> -->` marked sections, so reruns replace only those sections.
    - `cursorRule` is the same body with a frontmatter of `---\ndescription: surf-roadmap conventions\nalwaysApply: true\n---\n`.
  - CLI command `other-agents --repo <path> --targets <agents,cursor>`:
    - writes `AGENTS.md` with `planClaudeMd` semantics, keeping the user's own text outside the marked sections
    - writes `.cursor/rules/surf-roadmap.mdc`, overwriting it entirely
    - prints `{ ok: true, written: [paths] }`
    - an unknown target is a `UsageError`
  - Setup skill: after `apply`, ask one question, "Also write rules for Codex and Cursor (AGENTS.md, .cursor/rules)?" with options Yes / No. On yes, run `other-agents --targets agents,cursor`.

- [ ] **Step 1: Write the failing tests:**
  - **Fresh repo:** `other-agents --targets agents,cursor` creates both files. `AGENTS.md` contains the `roadmap` and `commits` sections, and the `.mdc` starts with the frontmatter.
  - **Rerun:** after the user has added a paragraph outside the sections, the rerun keeps the paragraph and leaves the sections identical.
  - **Bad target:** `--targets vim` exits 1 with a JSON error.
  - **Worktree variant:** follows `--worktrees forbidden` the same way CLAUDE.md does.
- [ ] **Step 2: Run** `npm run test:plugin`. Expected: FAIL.
- [ ] **Step 3: Implement.** The header text names the MCP URL `${ROADMAP_URL}/api/mcp` with the bearer header, and the plugin-free equivalents of the skills (plan through the roadmap's `plan` MCP prompt from Task 8).
- [ ] **Step 4: Run** `npm run test:plugin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(plugin): generate AGENTS.md and Cursor rules from the conventions`.

### Task 10: API key usage and rotation

**Files:**
- Modify: `src/lib/ops/api-keys.ts`, `src/server/trpc/routers/account.ts`, `src/components/api-key-manager.tsx`, `src/app/(app)/(global)/settings/api-keys/api-keys-view.tsx`
- Test: `src/lib/ops/api-keys.test.ts`

**Interfaces:**
- Consumes: `agent_run`, `agent_call` (Task 5); Better Auth `getAuth().api.createApiKey`.
- Produces:
  - `ApiKeyRow` gains `usage: { last7Days: number[]; total30Days: number; errors30Days: number }`.
    - `last7Days` holds 7 counts, oldest first, by UTC day, from `agent_call` joined to `agent_run` on `apiKeyId`.
    - `rotatedFrom: string | null` and `graceUntil: Date | null` are read from the key's `metadata` JSON.
  - `rotateApiKey(db, actor, id, create: (body) => Promise<{ key: string; id: string }>): Promise<{ key: string }>`.
    - The new key gets the same name, and the same lifetime length as the old one if it had an expiry (else none).
    - The old key gets `expiresAt = now + 24 h` (or its current expiry if sooner), and both keys' `metadata` record the link: the new key `{ rotatedFrom: oldId }`, the old one `{ rotatedTo: newId, graceUntil }`.
    - The `create` callback is injected so tests run without Better Auth; the router passes a wrapper over `getAuth().api.createApiKey`.
    - A key of another user throws `NotFoundError`.
  - tRPC `account.rotateApiKey({ id })` returns `{ key }`.
  - UI:
    - each key row shows a 7-day spark bar (inline SVG, bars drawn to scale from 0 to that key's max), "last used <relative time>", and "30 days: N calls, M errors"
    - **Rotate** opens an alert dialog: "A new key with the same name is created. The old key keeps working for 24 hours so you can update your agents, then it expires."
    - after rotation, the new key is shown once (reuse the existing reveal dialog), and the old row shows "expires in 24 h" with **Revoke now**

- [ ] **Step 1: Write the failing tests:**
  - **`rotateApiKey` with a fake `create`:**
    - the old key's `expiresAt` is within 24 h ± 1 minute of now
    - a 30-day key produces a new key with a 30-day lifetime
    - the metadata links in both directions
    - another user's key gives `NotFoundError`
    - an old key already expiring in 1 hour keeps that expiry
  - **Usage:** calls on days −1, −1 and −3 give `last7Days = [0,0,0,1,0,2,0]`, with the last element being today and zero.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/api-keys.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the ops, router and UI.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(keys): show API key usage and rotate keys with a grace period`.

### Task 11: Your sessions

**Files:**
- Create: `src/lib/ops/sessions.ts`, `src/lib/user-agent.ts`
- Create: `src/app/(app)/(global)/settings/sessions/page.tsx`, `src/app/(app)/(global)/settings/sessions/sessions-view.tsx`
- Modify: `src/server/trpc/routers/account.ts`, `src/components/shell/user-area.tsx` (menu item "Sessions"), `src/components/shell/command-menu.tsx` (an item), `src/server/trpc/init.ts` (the context also carries `sessionId: string | null`)
- Test: `src/lib/ops/sessions.test.ts`, `src/lib/user-agent.test.ts`

**Interfaces:**
- Consumes: the `session` table; `getAuth().api.getSession` (its result has `session.id`).
- Produces:
  - `describeUserAgent(ua: string | null): string`, a pure function that returns e.g. "Chrome on Windows", "Safari on iPhone", "Firefox on Linux", "Edge on Windows", "Claude desktop on macOS" or "Unknown device".
    - Order of checks: `Edg/` before `Chrome/`, `CriOS` means Chrome on iPhone, iPad and iPhone before Mac, Android before Linux.
  - `listSessions(db, actor, currentSessionId): Promise<{ id; device: string; ip: string | null; createdAt; lastActiveAt: Date; current: boolean }[]>`.
    - Covers the actor's unexpired sessions; `lastActiveAt = updatedAt`.
    - Order: current first, then newest activity.
  - `endSession(db, actor, id)` deletes one of the actor's sessions; an unknown or foreign session gives `NotFoundError`.
  - `endOtherSessions(db, actor, currentSessionId): Promise<{ ended: number }>`.
  - tRPC `account.sessions`, `account.endSession({ id })`, `account.endOtherSessions`.
  - `Context.sessionId` is set from the same `getSession` call that `sessionActor` makes. Add `sessionAuth(): Promise<{ actor; sessionId } | null>` so the lookup happens once, and keep `sessionActor()` as a wrapper returning `.actor`, because Parts 7–9 call it.
  - Page `/settings/sessions`:
    - a table of device, IP, signed in, last active, with a "This device" badge on the current one
    - **Sign out** per row, except the current one
    - **Sign out all other devices** behind an alert dialog

- [ ] **Step 1: Write the failing tests:**
  - **`describeUserAgent`:** at least 8 real UA strings, covering Chrome on Windows, Edge on Windows, Safari on iPhone, Chrome on iPhone (CriOS), Firefox on Linux, Chrome on Android, Safari on macOS, and null.
  - **`listSessions`:** leaves out expired sessions and flags the current one. `endOtherSessions` keeps only the current one and reports `ended: 2` for three sessions. `endSession` on another user's session gives `NotFoundError`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Deleting rows ends the session at once, because `cookieCache` is not enabled in `src/lib/auth/server.ts`. Add a comment there saying that enabling it would delay sign-outs.
- [ ] **Step 4: Run** `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(account): list signed-in sessions and sign out other devices`.

### Task 12: Auth events and the admin audit view

**Files:**
- Create: `src/db/schema/audit.ts` (export from index), migration via `npm run db:generate -- --name auth-events`
- Create: `src/lib/ops/audit.ts`
- Modify: `src/lib/auth/server.ts` (database hooks), `src/lib/auth/actor.ts` (`bearerAuth` records rejected and rate-limited keys), `src/server/trpc/routers/account.ts` (key created, revoked and rotated)
- Create: `src/server/trpc/routers/admin.ts` (register as `admin`), `src/app/(app)/(global)/admin/audit/page.tsx`, `src/app/(app)/(global)/admin/audit/audit-view.tsx`
- Modify: `src/components/shell/user-area.tsx` and `src/components/shell/command-menu.tsx` (an "Audit" link for admins)
- Test: `src/lib/ops/audit.test.ts`

**Interfaces:**
- Consumes: `Kv` / `valkeyKv()` / `memoryKv()` (Part 1), `agent_call`, `agent_run`.
- Produces:
  - Table `auth_event`:
    - columns: `id` bigserial pk, `at` timestamptz not null default now, `kind` text not null, `userId` text null FK `user.id` on delete set null, `discordId` text null, `apiKeyId` text null, `ip` text null, `userAgent` text null, `detail` text null
    - `kind` enum: `sign-in`, `sign-in-refused`, `session-ended`, `key-created`, `key-revoked`, `key-rotated`, `key-rejected`, `key-rate-limited`
    - index `(at desc)` and `(user_id, at desc)`
  - `recordAuthEvent(db, event: Omit<AuthEventRow, "id" | "at">): Promise<void>`: never throws, logs on failure.
  - `recordThrottled(db, kv: Kv, event, throttleKey: string, seconds: number)`: writes only when `kv.get(throttleKey)` is empty, then `kv.set(throttleKey, "1", seconds)`.
    - Used for `key-rejected` (throttle key `audit:rej:<first 12 chars of the key>`, 60 s; never store the key itself) and `key-rate-limited` (throttle key `audit:rl:<apiKeyId>`, 60 s).
  - `listAuditEvents(db, actor, filter: { kind?: string; userId?: string; before?: number; limit?: number })`: admin only (else `ForbiddenError`), newest first, keyset pagination by `id < before`, default limit 100, max 500.
  - `failedToolCalls(db, actor, { days = 7, limit = 100 })`: admin only; `agent_call` rows with `ok = false` joined to run and user.
  - `keyUsageOverview(db, actor)`: admin only; per key: name, owner, last used, calls in 30 days, errors in 30 days, rate-limited events in 30 days.
  - Hooks in `createAuth`:
    - `session.create.after` records `sign-in` with ip and userAgent from the session data.
    - The `before` refusal path records `sign-in-refused` with `discordId` before throwing.
    - `session.delete.after`, if the Better Auth version exposes it, records `session-ended`; if it doesn't, `endSession` / `endOtherSessions` (Task 11) and the sign-out route record it.
  - Page `/admin/audit` with three tabs: **Events** (filters kind and user, "Load more"), **Failed calls**, and **Keys**. Non-admins get `notFound()`, as `/admin/users` does.

- [ ] **Step 1: Write the failing tests:**
  - **`recordThrottled`:** with `memoryKv()`, two calls within the window write one row, and a call after `kv.del` writes a second.
  - **`listAuditEvents`:** as a non-admin gives `ForbiddenError`. Pagination with `before` returns the next older page, with no overlap. A `kind` filter works.
  - **`failedToolCalls`:** lists only `ok = false` rows from the last 7 days.
  - **`keyUsageOverview`:** counts `key-rate-limited` events per key.
  - **`recordAuthEvent`:** with a closed db (pass an executor that throws) it resolves without throwing.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/audit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Check the exact hook names in `node_modules/better-auth` (`databaseHooks.session.create.after`, `databaseHooks.session.delete`) before wiring. In `bearerAuth`, `kv` comes from `valkeyKv()`. The web process may use Valkey directly for this small key: it is a request-scoped read and write, not background work.
- [ ] **Step 4: Run** `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): record auth events and add the audit view`.

### Task 13: Retention job

**Files:**
- Create: `src/worker/jobs/retention.ts`
- Modify: the worker's job registration entry point from Part 1 (import the new module)
- Test: `src/worker/jobs/retention.test.ts`

**Interfaces:**
- Consumes: `registerJob`, the repeatable-job registration from Part 1, `QUEUE.maintenance`, `WorkerDeps`.
- Produces:
  - `pruneTelemetry(deps: WorkerDeps): Promise<{ calls: number; runs: number; events: number }>`.
    - Deletes `agent_call` with `at < now − 30 d` in batches of 5 000 (loop until fewer are deleted).
    - Then deletes `agent_run` with `last_call_at < now − 30 d` (cascade removes leftovers).
    - Then deletes `auth_event` with `at < now − 90 d`.
    - Uses `deps.now()`.
  - Job `prune-telemetry` on `QUEUE.maintenance`, repeated daily at `30 3 * * *` UTC.

- [ ] **Step 1: Write the failing test.** With `now` fixed, rows at −31 d are removed, rows at −29 d stay, and an `auth_event` at −91 d is removed while one at −60 d stays. With 12 000 old calls, all are removed across batches, and the function returns `calls: 12000`.
- [ ] **Step 2: Run** `npx vitest run src/worker/jobs/retention.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement and register.**
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): prune agent telemetry and auth events on a daily schedule`.

---

## Part completion

- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:plugin` and `npm run build`. All must be green.
- [ ] README, Agents section:
  - batch tools and brief responses in two lines
  - a link to `/api/docs`
  - the Agents page and what the plugin hooks send (repo, branch, session id, token totals; never code or prompts)
  - the REST change: `POST …/tasks` now takes `{ tasks: [...] }`
