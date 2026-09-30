# roadmap-app v2 Part 2: Work Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Richer data for tracking work: task notes, blocked reasons, checklists, estimates with rollups, reordering and moving tasks, dependencies between systems, custom fields, archiving, a duplicate warning when creating systems, question priority, and ADR history with ADR–task links. Each is exposed in the ops layer, tRPC, the agent tools and on the existing screens.

**Architecture:** Every feature is an ops-layer change (`src/lib/ops/*`) with a zod input, a transaction, access checks and `logChange` entries. Thin adapters sit on top: tRPC procedures for the web UI, and `defineTool` entries for MCP and REST. UI changes stay on screens that already exist: the task list, the system card, the systems table, the system page, the question card, the ADR page, the overview and settings. The board and table options for choosing which fields to show come in Part 3; this part only makes the data available.

**Tech Stack:** Drizzle ORM + drizzle-kit, Postgres 17 (`pg_trgm` contrib), PGlite with `@electric-sql/pglite/contrib/pg_trgm` in tests, tRPC 11, React Query 5, shadcn/ui.

**Spec:** none (see `2026-10-01-roadmap-v2-index.md`, "Spec"). Read the index first: its Global Constraints and Shared names apply to every task here.

## Global Constraints

- Everything in the index's Global Constraints applies: ops-layer rule, adapters, change-log vocabulary, migrations via `npm run db:generate -- --name <topic>`, tests on PGlite, shadcn-only UI, and commits in `type(scope): lowercase description` form ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- New change-log entities this part introduces: `check` (task checklist item), `dependency`, `field` (custom field definition). Existing entities get new fields: `task.notes`, `task.blockedReason`, `task.estimate`, `task.moved`, `task.position`, `system.fields.<key>`, `system.archived`, `project.archived`, `question.priority`, `adr.task`.
- Estimate sizes are exactly `S`, `M`, `L`, weighted `S = 1`, `M = 3`, `L = 8` points. An unestimated task counts 0 points and is reported separately.
- Question priorities are exactly `blocking`, `normal`, `nice`, with default `normal`.
- Custom field types are exactly `text`, `select`, `number`, `date`. Keys are slugs (`slugSchema`); dates are `YYYY-MM-DD`; values are stored as text.
- Archived rows keep their slugs, so a new system cannot reuse an archived system's slug.
- Tool descriptions: one or two sentences. New tools: `move_task`, `set_task_checks`, `set_dependencies`, `set_system_fields`, `archive_system`, `set_question_priority`. Every other change extends an existing tool's input or output.

## Review Focus

1. **A dependency cycle through three or more systems** (A → B → C, then C → A): rejected with a message naming the path, and nothing is written. Pinned in Task 5 (`set_dependencies` cycle test with three systems).
2. **Moving a task out of a system it was generated for by a plan** (`planStep` set): the step link is cleared, so the next `write_plan` on the old system creates a new task instead of renaming the moved one, and the move doesn't break the unique `(system_id, plan_step)` constraint on the target. Pinned in Task 4 (move keeps title/state/owner, clears `planStep`; follow-up `writePlan` test).
3. **A write to an archived system or project through any path** (tool, tRPC, a direct task id): refused with 409 "archived; restore it first", while reads still work. Pinned in Task 7 (updateTask on a task of an archived system, addTask, moveSystem, writeSpec, and a write in an archived project).
4. **A select option still in use is deleted from a custom field, or the field's type is changed:** removing the option is refused with 409 naming how many systems use it; the type cannot be changed at all. Pinned in Task 6.
5. **A blocking question is answered but not resolved, or its system is archived:** the planning gate counts only unresolved blocking questions on non-archived systems. Pinned in Task 9 (resolved clears the gap, `resolved: false` keeps it).

---

### Task 1: Task notes and blocked reason

**Files:**
- Modify: `src/db/schema/content.ts` (table `task`)
- Modify: `src/lib/ops/tasks.ts` (`updateTaskInput`, `updateTask`)
- Modify: `src/lib/ops/systems.ts` (`TaskItem`, `getSystem` select, `SystemListItem` + `listSystems` counts)
- Create: `src/lib/ops/blocked.ts` (`listBlockedTasks`)
- Modify: `src/lib/tools/definitions.ts` (`update_task` description)
- Modify: `src/server/trpc/routers/tasks.ts` (add `blocked` query)
- Modify: `src/components/task-list.tsx` (`TaskRow`)
- Modify: `src/components/system-card.tsx`
- Modify: `src/app/(app)/p/[project]/overview-view.tsx` (attention list) and its `page.tsx` (prefetch)
- Test: `src/lib/ops/tasks.test.ts`, `src/lib/ops/blocked.test.ts`

**Interfaces:**
- Consumes: `taskAccess`, `logChange`, `projectAccess`.
- Produces:
  - Columns `task.notes text not null default ''` (≤ 5000 chars) and `task.blocked_reason text` (nullable, ≤ 300 chars).
  - `updateTaskInput` gains `notes: z.string().max(5000).optional()` and `blockedReason: z.string().trim().min(1).max(300).optional()`.
  - `TaskItem` gains `notes: string` and `blockedReason: string | null`.
  - `SystemListItem` gains `tasksBlocked: number`.
  - `listBlockedTasks(db: Executor, actor: Actor, projectSlug: string): Promise<BlockedTask[]>`, where `BlockedTask = { id: number; title: string; reason: string | null; systemSlug: string; systemTitle: string; since: Date | null }`. `since` is the `createdAt` of the newest `change_log` row with `entity='task'`, `entityId=<id>`, `field='state'`, `newValue='blocked'`.

**Rules:**
- Setting `state: "blocked"` requires a reason: the patch's `blockedReason` or the task's existing `blocked_reason`. With neither, throw `InvalidError("Say what task <id> is waiting for: pass blockedReason.")`.
- Setting any state other than `blocked` clears `blocked_reason` to `null`, logged as field `blockedReason` with the old reason and `null`.
- `blockedReason` on a task that isn't blocked and isn't being set to blocked is refused with `InvalidError("Task <id> is not blocked.")`.
- `notes` changes are logged as field `notes` with old and new values each cut to 200 chars plus `…`, so the change log doesn't store whole notes twice.

- [ ] **Step 1: Schema.** Add the two columns to `task`. Run `npm run db:generate -- --name task-notes-blocked` and check the SQL adds exactly those two columns.
- [ ] **Step 2: Failing tests in `src/lib/ops/tasks.test.ts`.** Add a `describe("notes and blocked reason")` using `createProjectFixture`, a system created with `createSystem`, `completePlanningFixture` and `addTask`:
  - `updateTask(db, owner, id, { state: "blocked" })` rejects with `InvalidError` whose message contains `blockedReason`.
  - `{ state: "blocked", blockedReason: "waiting for API key" }` stores both. `getSystem(...).tasks[0].blockedReason === "waiting for API key"`. The change log has a `state` entry and a `blockedReason` entry.
  - Then `{ state: "doing" }` leaves `blockedReason === null`, logged with old value `"waiting for API key"`.
  - `{ blockedReason: "x" }` on a `todo` task rejects with `InvalidError`.
  - `{ notes: "a".repeat(300) }` stores 300 chars; the log entry's `newValue` has length 201 and ends in `…`.
  - `listSystems(...)` shows `tasksBlocked === 1` while blocked and `0` after.
- [ ] **Step 3: Failing test `src/lib/ops/blocked.test.ts`.**
  - Two systems, one blocked task each, plus one `doing` task. `listBlockedTasks` returns exactly the two blocked tasks with reasons, system slugs and a `since` date.
  - A viewer member can read them.
  - A non-member gets `NotFoundError`.
- [ ] **Step 4: Run** `npx vitest run src/lib/ops/tasks.test.ts src/lib/ops/blocked.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 5: Implement.**
  - Extend `updateTaskInput` and `updateTask`, following the rules above. Add `notes` and `blockedReason` to the per-field loop, with logging.
  - Add the columns to the `getSystem` task select.
  - Add `blocked: sql<number>\`count(*) filter (where state = 'blocked')\`` to the `listSystems` counts query.
  - Write `listBlockedTasks` with one query joining `task` → `system`, and one grouped query on `change_log` for `since`.
- [ ] **Step 6: Tool description.** Set `update_task` to: "Change a task's title, state, priority, owner, notes or blockedReason. Blocked needs a blockedReason; doing and done need completed planning." Add `tasks.blocked: protectedProcedure.input(z.object(P)).query(...)` calling `listBlockedTasks`.
- [ ] **Step 7: UI.**
  - **`TaskRow`:**
    - A "Blocked…" item in the state radio group opens a small `Dialog`. It has a `Textarea`, "What is it waiting for?", required, max 300, prefilled with the old reason, and Save/Cancel. Save sends `{ state: "blocked", blockedReason }`.
    - A blocked task shows its reason under the title in `text-xs text-cat-blocked`.
    - A "Notes" menu item opens a `Dialog` with a `Textarea` (max 5000) that saves `{ notes }`.
    - A task with notes shows a `StickyNote` lucide icon button (aria-label "Notes for <title>") that opens the same dialog, read-only for viewers.
  - **`SystemCard`:** when `tasksBlocked > 0`, show a `cat-blocked` chip "N blocked", with an accessible name like "2 blocked tasks".
  - **Overview:** prefetch `tasks.blocked`, and add one attention item per blocked task: kind `blocked`, title `Task #<id> is blocked`, detail `<reason> · <system title> · <relative since>`, href `/p/<slug>/systems/<systemSlug>`.
- [ ] **Step 8: Run** `npm test`, `npm run typecheck`, `npm run lint`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(tasks): add task notes and required blocked reasons`.

---

### Task 2: Estimates and rollups

**Files:**
- Modify: `src/db/schema/content.ts` (`TASK_ESTIMATES` constant, `task.estimate`)
- Create: `src/lib/ops/rollups.ts`
- Modify: `src/lib/ops/tasks.ts` (`addTaskInput`, `updateTaskInput`, `updateTask`)
- Modify: `src/lib/ops/systems.ts` (`TaskItem.estimate`, `SystemListItem` rollup fields)
- Modify: `src/lib/tools/definitions.ts` (`add_task`, `update_task` descriptions)
- Modify: `src/server/trpc/routers/structure.ts` (phase rollups query)
- Modify: `src/components/task-list.tsx`, `src/components/system-card.tsx`, `src/app/(app)/p/[project]/roadmap/roadmap-view.tsx`
- Test: `src/lib/ops/rollups.test.ts`

**Interfaces:**
- Produces:
  - `export const TASK_ESTIMATES = ["S", "M", "L"] as const; export type TaskEstimate = (typeof TASK_ESTIMATES)[number];` in `src/db/schema/content.ts`. Column `task.estimate text` with that enum, nullable.
  - `export const ESTIMATE_POINTS: Record<TaskEstimate, number> = { S: 1, M: 3, L: 8 }` in `rollups.ts`.
  - `export interface Rollup { tasks: number; done: number; points: number; pointsDone: number; unestimated: number }`.
  - `export function rollup(tasks: { state: TaskState; estimate: TaskEstimate | null }[]): Rollup` is pure. `done` counts state `done`; `points` sums all estimated tasks; `pointsDone` sums the done ones; `unestimated` counts tasks with `estimate === null`.
  - `export async function systemRollups(db: Executor, projectId: string, systemIds?: string[]): Promise<Map<string, Rollup>>` uses one grouped SQL query, with no per-system queries.
  - `export async function groupRollups(db: Executor, projectId: string, by: "phase" | "domain" | "board"): Promise<Map<string | null, Rollup>>` gives one grouped query per call. The key is the group id, with `null` for systems without a phase or domain. Archived systems (Task 7) are excluded once that task lands; leave a `// archived systems excluded in Task 7` note until then, and Task 7 replaces it. Part 8 calls this with a release grouping it adds itself.
  - `addTaskInput` and `updateTaskInput` gain `estimate: z.enum(TASK_ESTIMATES).nullable().optional()`.
  - `TaskItem` gains `estimate: TaskEstimate | null`. `SystemListItem` gains `points: number; pointsDone: number; unestimated: number`.

- [ ] **Step 1: Schema.** Add the column, then run `npm run db:generate -- --name task-estimate`.
- [ ] **Step 2: Failing tests `src/lib/ops/rollups.test.ts`.**
  - `rollup([])` returns `{ tasks: 0, done: 0, points: 0, pointsDone: 0, unestimated: 0 }`.
  - `rollup([{state:"done",estimate:"L"},{state:"todo",estimate:"M"},{state:"todo",estimate:null}])` returns `{ tasks: 3, done: 1, points: 11, pointsDone: 8, unestimated: 1 }`.
  - With the database: two systems in phase A and one without a phase, tasks with estimates S, M, L and none. `systemRollups` matches `rollup()` computed in JS for each system. `groupRollups(db, projectId, "phase")` has keys `phaseA.id` and `null`, with summed values.
  - `updateTask(..., { estimate: "M" })` logs field `estimate` from `null` to `"M"`; `{ estimate: null }` clears it.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/rollups.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `rollups.ts`. SQL sums use `case estimate when 'S' then 1 when 'M' then 3 when 'L' then 8 else 0 end`, taking the numbers from `ESTIMATE_POINTS` so they are defined once. Extend the task ops and the per-field loop, and add the three fields `points: number`, `pointsDone: number` and `unestimated: number` (from `Rollup`) to `SystemListItem` in `listSystems`, filled from `systemRollups`.
- [ ] **Step 5: Adapters.**
  - Tool descriptions: `add_task` becomes "Add a task to a system, optionally with an estimate (S, M, L)." `update_task` mentions `estimate`.
  - Add `structure.phaseRollups: protectedProcedure.input(z.object(P)).query(...)`, which returns `groupRollups(..., "phase")` as an array of `{ phaseId: string | null, ...Rollup }`, because superjson carries a Map but arrays are easier for the view.
- [ ] **Step 6: UI.**
  - **`TaskRow`:** an "Estimate" submenu (None, S, M, L). The estimate shows as a mono chip `S`/`M`/`L` before the owner avatar.
  - **Tasks panel header:** "12 / 30 pts" next to the task count when `points > 0`, and "3 unestimated" in muted text when `unestimated > 0`.
  - **`SystemCard`:** nothing new; Part 3's card-field picker offers "Points".
  - **Roadmap view:** each phase header shows "`pointsDone`/`points` pts" when `points > 0`, plus `tasks done/tasks`.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(tasks): add task estimates with system and phase rollups`.

---

### Task 3: Checklists inside tasks

**Files:**
- Create: `src/db/schema/content.ts` addition: table `taskCheck` (`task_check`)
- Create: `src/lib/ops/checks.ts`
- Modify: `src/lib/ops/systems.ts` (`TaskItem.checks`)
- Modify: `src/lib/tools/definitions.ts` (`set_task_checks`)
- Modify: `src/server/trpc/routers/tasks.ts` (`checks` sub-router)
- Modify: `src/components/task-list.tsx`
- Test: `src/lib/ops/checks.test.ts`

**Interfaces:**
- Produces:
  - Table `task_check`:
    - `id text primary key` (newId)
    - `task_id integer not null references task(id) on delete cascade`
    - `title text not null` (1–200 chars)
    - `done boolean not null default false`
    - `sort_order integer not null`
    - Index on `task_id`.
  - `TaskItem` gains `checks: { id: string; title: string; done: boolean }[]`, ordered by `sort_order`. It is loaded in `getSystem` with one query for all the system's tasks, never one query per task.
  - `addCheckInput = z.object({ title: z.string().trim().min(1).max(200) })`.
  - `addCheck(db, actor, taskId: number, raw): Promise<{ id: string }>` appends at the end.
  - `updateCheck(db, actor, checkId: string, raw: { title?: string; done?: boolean }): Promise<void>`.
  - `deleteCheck(db, actor, checkId: string): Promise<void>`.
  - `setTaskChecksInput = z.object({ items: z.array(z.object({ title: z.string().trim().min(1).max(200), done: z.boolean().default(false) })).max(50) })`.
  - `setTaskChecks(db, actor, taskId: number, raw): Promise<{ checks: number; done: number }>` replaces the whole list in one transaction. It matches existing items by exact title, so their ids are kept; everything unmatched is deleted and new titles are inserted in the given order.
  - All check ops require editor, go through `taskAccess` (the Task 7 archive check applies automatically once it lands), and log on `entity: "check"` with the check id, `systemId` of the parent, and fields `created`, `title`, `done` or `deleted`. `setTaskChecks` logs one entry: `entity: "task"`, `entityId: taskId`, `field: "checks"`, `newValue: "<done>/<total>"`.
- [ ] **Step 1: Schema.** Add the table, then run `npm run db:generate -- --name task-checks`.
- [ ] **Step 2: Failing tests `src/lib/ops/checks.test.ts`.**
  - `addCheck` twice, then `getSystem` gives `checks` in insertion order with `done: false`.
  - `updateCheck(id, { done: true })` flips it and logs `check`/`done`.
  - `deleteCheck` removes it.
  - `setTaskChecks(task, { items: [{title:"b"}, {title:"a", done:true}] })` on a task with checks `a`, `c` keeps the id of `a`, deletes `c`, inserts `b` first, and returns `{ checks: 2, done: 1 }`.
  - 51 items is a `ZodError` (400).
  - A viewer gets `ForbiddenError`.
  - Deleting the task deletes its checks.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/checks.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `checks.ts` and the `getSystem` load (one `inArray(taskCheck.taskId, ids)` query, grouped in JS).
- [ ] **Step 5: Adapters.**
  - Tool `set_task_checks`:
    - description "Replace a task's checklist; items matched by title keep their state unless done is given."
    - input `{ id: intParam("Task id."), ...setTaskChecksInput.shape }`, `write: true`, `method: "PUT"`, `path: "/tasks/:id/checks"`
  - tRPC `tasks.checks = router({ add, update, delete })` with inputs `{ taskId, check: addCheckInput }`, `{ id, patch }` and `{ id }`.
- [ ] **Step 6: UI in `TaskRow`.**
  - When a task has checks, show a `2/5` mono counter button after the title, with aria-label "Checklist of <title>, 2 of 5 done". It expands an indented list under the row: a `Checkbox` per item (viewers get a disabled checkbox) and an "Add item" input for editors (Enter adds, and focus stays in the input).
  - Each item has a remove icon button, aria-label "Remove <item>".
  - An "Add checklist" menu item on tasks without checks opens the expanded, empty list.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(tasks): add checklists inside tasks`.

---

### Task 4: Reorder tasks and move a task to another system

**Files:**
- Modify: `src/lib/ops/tasks.ts` (`reorderTasks`, `moveTask`)
- Modify: `src/lib/tools/definitions.ts` (`move_task`)
- Modify: `src/server/trpc/routers/tasks.ts` (`reorder`, `move`)
- Modify: `src/components/task-list.tsx`
- Create: `src/components/move-task-dialog.tsx`
- Test: `src/lib/ops/tasks.test.ts`, `src/lib/ops/documents.test.ts`

**Interfaces:**
- Consumes: `checkPermutation` pattern from `src/lib/ops/structure.ts` (read it; copy its behaviour, with Part 0's fixed reorder semantics that write every row whose `sortOrder` differs from its index).
- Produces:
  - `reorderTasksInput = z.object({ orderedIds: z.array(z.number().int().positive().max(2147483647)).min(1).max(500) })`.
  - `reorderTasks(db, actor, projectSlug, systemSlug, raw): Promise<void>`: editor. `orderedIds` must be a permutation of the system's task ids (otherwise `InvalidError`). It writes `sortOrder = index` for every task whose `sortOrder !== index` and logs one entry: `entity: "task"`, `entityId: <systemId>`, `field: "position"`, `newValue: "reordered"`, `systemId` set.
  - `moveTaskInput = z.object({ system: slugSchema })`.
  - `moveTask(db, actor, taskId: number, raw): Promise<void>`: editor. Rules:
    - The target system must be in the same project as the task, otherwise `NotFoundError("Unknown system <slug>.")`.
    - Moving to the same system is `InvalidError`.
    - A task in state `doing` or `done` cannot move into a system whose planning is incomplete. That is a `ConflictError` with `planningGateMessage(target.slug, gaps)`.
    - The task keeps its id, title, state, owner, notes, estimate and checks. `planStep` becomes `null`, and `sortOrder` becomes the target's `max + 1`.
    - `progress_update.task_id` references keep pointing at the task.
    - It logs two entries: `field: "moved"`, `oldValue: sourceSlug`, `newValue: targetSlug`, once with `systemId: source.id` and once with `systemId: target.id`, so both systems' histories show it.
    - Lock order: lock both system rows `FOR NO KEY UPDATE` in ascending `id` order before touching the task. This is the same system-before-task order Part 0 sets for `taskAccess`.
- [ ] **Step 1: Failing tests in `tasks.test.ts`, `describe("reorder and move")`.**
  - Tasks t1, t2, t3. `reorderTasks([t3, t1, t2])` makes `getSystem` return that order and writes one log entry.
  - `[t1, t2]` (missing t3) is `InvalidError`.
  - `[t1, t1, t2]` is `InvalidError`.
  - Moving t2, which has `planStep: 2` from `writePlan`, to system B means B's tasks include t2 with `planStep === null` and A's tasks exclude it. Both systems have a `moved` log entry.
  - Moving a `doing` task into a system still in planning is `ConflictError`.
  - Moving to a system in another project is `NotFoundError`.
  - A progress update posted with `taskId: t2` before the move still has `taskId === t2`.
- [ ] **Step 2: Failing test in `documents.test.ts`.** After t2 (step 2) moves from A to B, `writePlan` on A with steps 1..3 creates a new task for step 2 (`createdTasks.length === 1`) and doesn't rename t2.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/tasks.test.ts src/lib/ops/documents.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `reorderTasks` and `moveTask`.
- [ ] **Step 5: Adapters.**
  - Tool `move_task`:
    - description "Move a task to another system of the same project; it keeps its state, owner and checklist."
    - input `{ id: intParam("Task id."), ...moveTaskInput.shape }`, `method: "POST"`, `path: "/tasks/:id/move"`
    - No reorder tool: agents don't need it, and it would cost tool-list tokens.
  - tRPC `tasks.reorder` (input `{ ...S, orderedIds }`) and `tasks.move` (input `{ id, to: moveTaskInput }`).
- [ ] **Step 6: UI.**
  - **Reorder by dragging:** in `TaskList` for editors, give each row a `GripVertical` drag handle using native HTML5 drag and drop, with an optimistic order and a rollback on error, following the `board-view.tsx` pattern.
  - **Reorder by keyboard:** the row menu gets "Move up" and "Move down", so reordering works without dragging.
  - **Move to another system:** "Move to system…" opens `MoveTaskDialog`, which is built from `Command` with search and lists the project's other systems from `systems.list`. Choosing one calls `tasks.move` and toasts "Moved to <title>". The toast lives in the mutation options, because the row unmounts.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(tasks): reorder tasks and move them between systems`.

---

### Task 5: System dependencies

**Files:**
- Modify: `src/db/schema/content.ts` (table `systemDependency`)
- Create: `src/lib/ops/dependencies.ts`
- Modify: `src/lib/ops/systems.ts` (`systemFilter.startable`, `SystemListItem.blockedBy`, `listSystems`)
- Modify: `src/lib/ops/overview.ts` (`getSystemOverview` adds dependencies)
- Modify: `src/lib/tools/definitions.ts` (`set_dependencies`; `list_systems` description)
- Modify: `src/server/trpc/routers/systems.ts` (`setDependencies`)
- Modify: `plugin/commands/next.md` and `plugin/skills/track-work/SKILL.md` (use `startable: true`)
- Modify: `src/components/system-card.tsx`, `src/components/system/properties.tsx`
- Test: `src/lib/ops/dependencies.test.ts`

**Interfaces:**
- Produces:
  - Table `system_dependency`:
    - `system_id text not null references system(id) on delete cascade`
    - `depends_on_id text not null references system(id) on delete cascade`
    - `created_at timestamptz not null default now()`
    - Primary key `(system_id, depends_on_id)`, plus an index on `depends_on_id`.
  - `setDependenciesInput = z.object({ dependsOn: z.array(slugSchema).max(20) })`.
  - `setDependencies(db, actor, projectSlug, systemSlug, raw): Promise<{ dependsOn: string[] }>`: editor. Replaces the system's dependency set. Rules:
    - Every slug must be a system of the same project (otherwise `NotFoundError`).
    - A system can't depend on itself (`InvalidError`).
    - A new edge that would close a cycle is a `ConflictError("Dependency cycle: a → b → c → a.")`, found with a recursive CTE over `system_dependency` from each new target back to the system.
    - Logs `entity: "dependency"`, `entityId: <systemId>:<dependsOnId>`, `field: "created"` / `"deleted"`, with the dependency's slug as the value, and `systemId` set.
    - Locks the project's dependency writes with `pg_advisory_xact_lock(hashtext('deps:' || project_id))`, so two concurrent writers can't create a cycle between them.
  - `blockedByOf(db: Executor, projectId: string): Promise<Map<string, string[]>>` maps a system id to the slugs of the systems it depends on that are not in a column of category `done`. It uses one query.
  - `SystemListItem` gains `blockedBy: string[]` and `dependsOn: string[]`.
  - `systemFilter` gains `startable: z.boolean().optional()`. `true` keeps systems with an empty `blockedBy` whose column category is not `done`. `false` keeps systems with a non-empty `blockedBy`. REST query strings pass `"true"` / `"false"`; check that `coerceQuery` in `src/lib/tools/rest.ts` already handles booleans, and add a `z.preprocess` for `"true"`/`"false"` if it doesn't.
  - `getSystemOverview` result gains `dependencies: { dependsOn: { slug; title; columnCategory }[]; dependents: { slug; title; columnCategory }[] }`.
- [ ] **Step 1: Schema.** Add the table, then run `npm run db:generate -- --name system-dependencies`.
- [ ] **Step 2: Failing tests `src/lib/ops/dependencies.test.ts`.**
  - Systems a, b and c. `setDependencies(a, ["b"])`, then `listSystems` gives a `{ dependsOn: ["b"], blockedBy: ["b"] }`.
  - Move b to a done column (`completePlanningFixture` plus `moveSystem`), and a's `blockedBy` becomes `[]`.
  - `startable: true` includes a and c and excludes b (done). With b not done it would exclude a.
  - Cycle: `a → b`, `b → c`, then `setDependencies(c, ["a"])` is `ConflictError` whose message contains `c → a → b → c`, and nothing is written.
  - `setDependencies(a, ["a"])` is `InvalidError`.
  - An unknown slug is `NotFoundError`.
  - Replacing `["b"]` with `["c"]` logs one `deleted` entry and one `created` entry.
  - `getSystemOverview(b).dependencies.dependents` lists a.
  - A viewer gets `ForbiddenError`.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/dependencies.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** The recursive CTE walks `depends_on_id` edges starting from each proposed target and reports a path when it reaches the system; build the path text from the slugs.
- [ ] **Step 5: Adapters.**
  - Tool `set_dependencies`:
    - description "Set which systems this system depends on (replaces the list); cycles are rejected."
    - `method: "PUT"`, `path: "/projects/:project/systems/:system/dependencies"`
  - `list_systems` description gains ", or startable (no unfinished dependencies)".
  - tRPC `systems.setDependencies`.
  - In `plugin/commands/next.md` and `track-work/SKILL.md`, replace the instruction that lists systems for the next pick with one that calls `list_systems` with `startable: true`, and say that systems with `blockedBy` are skipped. Then run `npm run test:plugin`.
- [ ] **Step 6: UI.**
  - **`SystemCard`:** when `blockedBy.length > 0`, show a `Link2` icon chip "Blocked by N" in `cat-blocked` whose title lists the slugs.
  - **`properties.tsx`:** a "Depends on" row lists dependency chips (category dot + title, linking to each system). Editors get a `Popover` + `Command` multi-select of the project's other systems that saves through `systems.setDependencies`, with a conflict toast showing the cycle message. A "Needed by" row lists the dependents.
- [ ] **Step 7: Run** `npm test && npm run test:plugin && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(systems): add dependencies between systems with cycle checks`.

---

### Task 6: Custom fields

**Files:**
- Modify: `src/db/schema/projects.ts` (table `customField`), `src/db/schema/content.ts` (table `systemFieldValue`)
- Create: `src/lib/ops/fields.ts`
- Modify: `src/lib/ops/systems.ts` (`SystemListItem.fields`, `listSystems`)
- Modify: `src/lib/ops/overview.ts` (fields with definitions)
- Modify: `src/lib/tools/definitions.ts` (`set_system_fields`; `get_project` output)
- Create: `src/server/trpc/routers/fields.ts`, and register it in `src/server/trpc/router.ts`
- Create: `src/app/(app)/p/[project]/settings/fields/page.tsx` and `fields-view.tsx`
- Modify: `src/components/settings/settings-nav.tsx`, `src/components/system/properties.tsx`, `src/components/systems/systems-table.tsx`
- Test: `src/lib/ops/fields.test.ts`

**Interfaces:**
- Produces:
  - `export const FIELD_TYPES = ["text", "select", "number", "date"] as const; export type FieldType = (typeof FIELD_TYPES)[number];`
  - Table `custom_field`:
    - `id text pk`
    - `project_id text not null references project(id) on delete cascade`
    - `key text not null`
    - `name text not null` (1–60)
    - `type text not null` (enum `FIELD_TYPES`)
    - `options jsonb not null default '[]'` (`string[]`; used only for `select`, 1–50 options, each 1–60 chars, unique case-insensitively)
    - `sort_order integer not null`
    - `created_at timestamptz not null default now()`
    - Unique `(project_id, key)`.
  - Table `system_field_value`:
    - `system_id text not null references system(id) on delete cascade`
    - `field_id text not null references custom_field(id) on delete cascade`
    - `value text not null`
    - Primary key `(system_id, field_id)`.
  - `CustomFieldRow = typeof customField.$inferSelect`.
  - `fieldInput = z.object({ key: slugSchema, name: z.string().trim().min(1).max(60), type: z.enum(FIELD_TYPES), options: z.array(z.string().trim().min(1).max(60)).max(50).default([]) })`, refined so that `select` needs at least 1 option and other types need exactly 0.
  - `updateFieldInput = z.object({ name: ....optional(), options: ....optional() })`. There is no `type`, so type changes are impossible.
  - Ops:
    - `listCustomFields(db: Executor, actor, projectSlug): Promise<CustomFieldRow[]>`: viewer, by `sort_order`.
    - `createCustomField(db, actor, projectSlug, raw): Promise<CustomFieldRow>`: owner.
    - `updateCustomField(db, actor, projectSlug, key: string, raw): Promise<void>`: owner. Removing an option that `system_field_value` rows still use is `ConflictError("Option \"<o>\" is used by N systems; change them first.")`.
    - `deleteCustomField(db, actor, projectSlug, key): Promise<void>`: owner; cascades the values.
    - `reorderCustomFields(db, actor, projectSlug, orderedKeys: string[]): Promise<void>`: owner.
    - `setSystemFields(db, actor, projectSlug, systemSlug, raw: { values: Record<string, string | number | null> }): Promise<void>`: editor.
  - `setSystemFields` rules:
    - An unknown key is `InvalidError("Unknown field <key>.")`.
    - `null` deletes the value.
    - `text` is 1–500 chars after trimming.
    - `number` is finite, stored as `String(n)`.
    - `date` matches `^\d{4}-\d{2}-\d{2}$` and is a real date.
    - `select` must equal one of the options (exact match after trimming).
    - Each changed key is logged as `entity: "system"`, `field: "fields.<key>"`.
  - Definition ops log `entity: "field"`, `entityId: <fieldId>`, with fields `created`, `name`, `options` (JSON text), `position` or `deleted`.
  - `SystemListItem` gains `fields: Record<string, string>`, keyed by field key, from one query.
  - `getSystemOverview` gains `fields: { key; name; type; options; value: string | null }[]`, in definition order.
  - `getProject` (tool `get_project`) gains `fields: CustomFieldRow[]` without `projectId`, so agents learn the keys without an extra tool.
- [ ] **Step 1: Schema.** Add the tables, then run `npm run db:generate -- --name custom-fields`.
- [ ] **Step 2: Failing tests `src/lib/ops/fields.test.ts`.**
  - The owner creates `risk` (select `low`/`high`), `effort` (number) and `due` (date).
  - `setSystemFields(sys, { values: { risk: "high", effort: 5, due: "2026-11-02" } })`, then `listSystems` gives `fields` equal to `{ risk: "high", effort: "5", due: "2026-11-02" }`.
  - `risk: "medium"` is `InvalidError`.
  - `due: "2026-02-30"` is `InvalidError`.
  - `effort: Infinity` is `InvalidError` (pass `Number.POSITIVE_INFINITY`).
  - Unknown key `foo` is `InvalidError`.
  - `{ risk: null }` removes the value.
  - `updateCustomField(risk, { options: ["low"] })` while one system uses `high` is `ConflictError` mentioning "1 system".
  - An editor calling `createCustomField` gets `ForbiddenError`, while `setSystemFields` works for editors and viewers get `ForbiddenError`.
  - `deleteCustomField` drops the values.
  - `fieldInput` with `type: "text", options: ["x"]` fails to parse.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/fields.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `fields.ts` and the list and overview additions.
- [ ] **Step 5: Adapters.**
  - Tool `set_system_fields`:
    - description "Set custom field values of a system by key (see get_project fields); null clears one."
    - input `{ ...S, values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])) }`, `method: "PATCH"`, `path: "/projects/:project/systems/:system/fields"`
  - tRPC `fields` router: `list`, `create`, `update`, `delete`, `reorder`, `setValues`.
- [ ] **Step 6: UI.**
  - **Settings → Fields** (owner) at `/p/<slug>/settings/fields`: added to `settings-nav.tsx` with a count. The page is a list of fields in the style of the structure settings, with create/edit dialogs (name, key auto-slugified until edited, type select, options editor for select types), up/down reorder buttons, and delete with an `AlertDialog`.
  - **`properties.tsx`:** one row per field, with the right editor for editors: `Input` for text, `Input type=number`, `Input type=date`, `NativeSelect` for select. Saves on blur or change; viewers see plain values.
  - **`systems-table.tsx`:** one column per field after the existing columns, header = field name, cell = value. Part 3's column picker makes them optional.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(fields): add per-project custom fields on systems`.

---

### Task 7: Archive projects and systems

**Files:**
- Modify: `src/db/schema/projects.ts` (`project.archivedAt`), `src/db/schema/content.ts` (`system.archivedAt`)
- Modify: `src/lib/ops/access.ts` (`projectAccess`, `projectAccessById` options)
- Modify: `src/lib/ops/lookup.ts` (`findSystem`)
- Create: `src/lib/ops/archive.ts`
- Modify:
  - `src/lib/ops/projects.ts` (`listProjects` option)
  - `src/lib/ops/systems.ts` (`systemFilter.archived`)
  - `src/lib/ops/summaries.ts` (nav and cards counts)
  - `src/lib/ops/rollups.ts` (exclude archived)
  - `src/lib/ops/tasks.ts` (`taskAccess` check)
- Modify: `src/lib/tools/definitions.ts` (`archive_system`), `src/server/trpc/routers/projects.ts` and `systems.ts`
- Modify: `src/app/(app)/(global)/home-view.tsx`, `src/components/shell/command-menu.tsx`, `src/components/board-view.tsx` (data only), `src/components/system/header-actions.tsx`, `src/components/project-settings.tsx`, `src/app/(app)/p/[project]/layout.tsx` (banner)
- Test: `src/lib/ops/archive.test.ts`

**Interfaces:**
- Produces:
  - Columns `project.archived_at timestamptz` and `system.archived_at timestamptz`, both nullable.
  - `projectAccess(db, actor, slug, need, opts?: { allowArchived?: boolean })` and the same for `projectAccessById`. When the project is archived and `need !== "viewer"` and not `opts?.allowArchived`, it throws `ConflictError("Project <slug> is archived; an owner can restore it.")`.
  - `findSystem(db, projectId, slug, lock = false, opts?: { allowArchived?: boolean })`. With `lock === true` (the write path) and an archived system, it throws `ConflictError("System <slug> is archived; restore it first.")` unless `allowArchived`. `taskAccess` in `tasks.ts` gets the same check on the joined system row.
  - `archiveProject(db, actor, slug): Promise<void>` and `restoreProject(...)`: owner, using `allowArchived: true`. They log `project`/`archived` with `"true"` / `"false"`.
  - `setSystemArchived(db, actor, projectSlug, systemSlug, archived: boolean): Promise<void>`: editor, `allowArchived: true`. It logs `system`/`archived`.
  - `listProjects(db, actor, opts?: { archived?: "exclude" | "include" | "only" })`, default `"exclude"`. `ProjectListItem` gains `archivedAt: Date | null`.
  - `systemFilter` gains `archived: z.enum(["exclude", "include", "only"]).default("exclude")`. `SystemListItem` gains `archivedAt: Date | null`.
  - Board data, `projectNav` counts, `projectSummaries` (home cards), `blockedByOf`, `systemRollups` / `groupRollups`, `listBlockedTasks` and the planning-gap blocking-question check (Task 9) all exclude archived systems.
- [ ] **Step 1: Schema.** Add both columns, then run `npm run db:generate -- --name archive`.
- [ ] **Step 2: Failing tests `src/lib/ops/archive.test.ts`.**
  - Archive system s (with one task t). `listSystems` default excludes s, `archived: "only"` returns only s, and `archived: "include"` returns all.
  - These are all `ConflictError` with message containing "archived": `updateSystem(s, { title })`, `addTask(s)`, `updateTask(t, { title })`, `moveSystem(s)` and `writeSpec(s)`.
  - `getSystem(s)` still works for a viewer.
  - `setSystemArchived(s, false)` restores it and writes work again.
  - Archive the project: `listProjects` excludes it, while `{ archived: "only" }` returns it. `createSystem` in it is `ConflictError`, `getProject` works, `restoreProject` works, and an editor calling `archiveProject` gets `ForbiddenError`.
  - An archived system's slug is still taken: `createSystem` with the same slug is `ConflictError` (the existing unique mapping).
  - `projectNav` counts exclude archived systems.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/archive.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.** Pass `{ allowArchived: true }` only from the archive and restore ops and from `deleteProject`. Search every call of `projectAccess(` with need `"editor"` or `"owner"` and of `findSystem(…, true)`, and confirm none needs `allowArchived`. List any exception in the commit body.
- [ ] **Step 5: Adapters.**
  - Tool `archive_system`:
    - description "Archive a system (hidden, read-only) or restore it with restore: true."
    - input `{ ...S, restore: z.boolean().default(false) }`, `method: "POST"`, `path: "/projects/:project/systems/:system/archive"`
  - `list_systems` gets `archived` through `systemFilter`. No project archive tool: that's an owner action in the UI.
  - tRPC `projects.archive` / `projects.restore` and `systems.setArchived`. `projects.list` and `projects.cards` accept `{ archived }`.
- [ ] **Step 6: UI.**
  - **Home:** an "Archived (N)" toggle link under the grid shows archived projects greyed, with a "Restore" button for owners.
  - **Project settings:** a "Danger zone" section gets "Archive project" (owner) with an `AlertDialog`.
  - **Archived project banner:** in the project layout, "This project is archived and read-only." with Restore for owners.
  - **System header actions:** "Archive" / "Restore" for editors. The archived system page shows a banner, and its edit controls are disabled via a new `archived` flag next to `canEdit`.
  - **Systems page:** an "Archived" filter option.
  - **Command menu:** leaves out archived items.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(archive): archive and restore projects and systems`.

---

### Task 8: Duplicate warning on system create

**Files:**
- Create: a custom migration via `npx drizzle-kit generate --custom --name pg-trgm`, containing `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and `CREATE INDEX IF NOT EXISTS system_title_trgm ON system USING gin (title gin_trgm_ops);`
- Modify: `src/test/db.ts` (PGlite with the `pg_trgm` extension)
- Create: `src/lib/ops/similar.ts`
- Modify: `src/server/trpc/routers/systems.ts` (`similar`), `src/lib/tools/definitions.ts` (`create_system` result)
- Modify: `src/components/new-system-dialog.tsx`
- Test: `src/lib/ops/similar.test.ts`

**Interfaces:**
- Produces:
  - In `src/test/db.ts`: `new PGlite({ extensions: { pg_trgm } })` with `import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";`, applied to the template, so clones keep it.
  - `similarSystemsInput = z.object({ title: z.string().trim().min(3).max(120), limit: z.number().int().min(1).max(10).default(3) })`.
  - `similarSystems(db: Executor, actor, projectSlug, raw): Promise<SimilarSystem[]>`, with `SimilarSystem = { slug: string; title: string; score: number; archived: boolean }`. Viewer. It uses `similarity(lower(title), lower($1))` with the threshold `SIMILARITY_THRESHOLD = 0.35` (exported constant) and orders by score descending. It includes archived systems, flagged, because they block the slug too.
  - The `create_system` tool result becomes `{ ...systemRow, similar: SimilarSystem[] }`, with the created system itself left out. The tRPC `systems.create` result stays `{ slug }`.
- [ ] **Step 1: Migration.** Create the custom migration with the two statements. Confirm the file is listed in `drizzle/meta/_journal.json`.
- [ ] **Step 2: Test harness.** Add the `pg_trgm` extension to `migratedTemplate()` in `src/test/db.ts`. Run `npm test`. Expected: the whole existing suite still passes with the extension loaded.
- [ ] **Step 3: Failing tests `src/lib/ops/similar.test.ts`.**
  - Systems "Search index" and "Billing exports".
  - `similarSystems({ title: "search indexer" })` has "Search index" first with `score >= 0.35`.
  - `{ title: "Payroll" }` returns `[]`.
  - `{ title: "ab" }` is a `ZodError`.
  - An archived "Search index" still appears with `archived: true`.
  - A non-member gets `NotFoundError`.
  - The `create_system` tool through `runTool` (see `src/lib/tools/registry.test.ts` for how tests call tools) creating "Search indexes" returns `similar[0].slug === "search-index"`.
- [ ] **Step 4: Run** `npx vitest run src/lib/ops/similar.test.ts`. Expected: FAIL.
- [ ] **Step 5: Implement** `similar.ts` and the `create_system` wrapper.
- [ ] **Step 6: UI.** In `NewSystemDialog`, run `trpc.systems.similar` with the title debounced by 300 ms (a small `useDebouncedValue` hook in the same file) once the title is at least 3 chars. Show a muted note under the title field: "Similar: <link>Search index</link>, <link>…</link>". Each link opens in a new tab (`target="_blank"`), and archived ones are marked "(archived)". It never blocks submit.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(systems): warn about similar systems when creating one`.

---

### Task 9: Question priority

**Files:**
- Modify: `src/db/schema/content.ts` (`QUESTION_PRIORITIES`, `question.priority`)
- Modify: `src/lib/ops/questions.ts` (`addQuestionInput`, `setQuestionPriority`, `listQuestions` order)
- Modify: `src/lib/ops/planning.ts` (`planningGaps`)
- Modify: `src/lib/tools/definitions.ts` (`add_question` description, `set_question_priority`)
- Modify: `src/server/trpc/routers/questions.ts`
- Modify: `src/components/question-card.tsx`, `src/components/questions/ask-question-dialog.tsx`, `src/app/(app)/p/[project]/overview-view.tsx`
- Test: `src/lib/ops/questions.test.ts`, `src/lib/ops/planning.test.ts`

**Interfaces:**
- Produces:
  - `export const QUESTION_PRIORITIES = ["blocking", "normal", "nice"] as const; export type QuestionPriority = ...`. Column `question.priority text not null default 'normal'` with that enum.
  - `addQuestionInput` gains `priority: z.enum(QUESTION_PRIORITIES).default("normal")`.
  - `setQuestionPriority(db, actor, projectSlug, id: string, priority: QuestionPriority): Promise<void>`: editor. It locks the question row `FOR UPDATE` and logs `question`/`priority`.
  - `listQuestions` orders unresolved `blocking` first, then `normal`, then `nice`, then by `createdAt` descending within each group. The view type gains `priority`.
  - `planningGaps(db, systemId)` appends, for each unresolved `blocking` question tied to the system (on a non-archived system), `Question <id> is blocking: "<short title>".` This affects `complete_planning`, `update_task` to doing/done and the move out of planning, which all use `planningGaps`.
- [ ] **Step 1: Schema.** Add the column, then run `npm run db:generate -- --name question-priority`.
- [ ] **Step 2: Failing tests.**
  - `questions.test.ts`: `addQuestion({ title, priority: "blocking" })` stores it. `listQuestions` puts it before an older `normal` one. `setQuestionPriority(id, "nice")` logs from `blocking` to `nice`. A viewer gets `ForbiddenError`. `priority: "urgent"` is a `ZodError`.
  - `planning.test.ts`: a system with all four areas answered and a spec has `planningGaps == []`.
    - Adding a blocking question on that system makes the gaps contain `is blocking`, and `completePlanning` is `ConflictError`.
    - `answerQuestion({ id, answer, resolved: false })` keeps the gap.
    - `resolved: true` clears it.
    - A `normal` question never adds a gap.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/questions.test.ts src/lib/ops/planning.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Adapters.**
  - `add_question` description gains "Priority blocking holds the system's planning gate until resolved."
  - Tool `set_question_priority`:
    - description "Set a question's priority: blocking, normal or nice."
    - input `{ ...P, id: z.string().min(1), priority: z.enum(QUESTION_PRIORITIES) }`, `method: "PATCH"`, `path: "/projects/:project/questions/:id/priority"`
  - tRPC `questions.setPriority`.
- [ ] **Step 6: UI.**
  - **`QuestionCard`:** a priority chip: "Blocking" in `cat-blocked`, "Nice to know" muted, nothing for normal. Editors get a `DropdownMenu` to change it.
  - **Ask dialog:** a priority `NativeSelect` (Normal default).
  - **Overview attention:** blocking questions show regardless of age, first among question items, titled `Blocking: <title>`. Non-blocking ones keep the stale rule.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(questions): add question priority and let blocking questions hold the planning gate`.

---

### Task 10: ADR status history and ADR–task links

**Files:**
- Modify: `src/db/schema/content.ts` (table `adrTask`)
- Modify: `src/lib/ops/adrs.ts` (`createAdrInput.tasks`, `updateAdrInput.tasks`, `getAdr` history and tasks)
- Modify: `src/lib/ops/systems.ts` (`TaskItem.adrs`)
- Modify: `src/lib/tools/definitions.ts` (`create_adr`, `update_adr`, `get_adr` descriptions)
- Modify: `src/app/(app)/p/[project]/adrs/[number]/adr-view.tsx`, `src/components/task-list.tsx`
- Test: `src/lib/ops/adrs.test.ts`

**Interfaces:**
- Produces:
  - Table `adr_task`:
    - `adr_id text not null references adr(id) on delete cascade`
    - `task_id integer not null references task(id) on delete cascade`
    - Primary key `(adr_id, task_id)`, plus an index on `task_id`.
  - `createAdrInput` and `updateAdrInput` gain `tasks: z.array(z.number().int().positive().max(2147483647)).max(50)`, with `.default([])` on create and `.optional()` on update, replacing the set on update.
  - Every task id must belong to a system of the same project (otherwise `NotFoundError("Unknown task <id>.")`).
  - Links may change on accepted and superseded ADRs too. `updateAdr` must allow a patch containing only `tasks` (or only `systems`) on an accepted ADR while still refusing content fields. Read the current immutability check and keep it for `title`/`context`/`decision`/`alternatives`/`consequences` only, which also fixes the Part 0 "logs unchanged fields" item if it isn't already fixed.
  - Link changes are logged as `entity: "adr"`, `field: "task"`, `newValue: "#<id>"` (created) or `oldValue: "#<id>"` (removed).
  - `AdrDetail` gains:
    - `tasks: { id: number; title: string; state: TaskState; systemSlug: string }[]`
    - `history: { at: Date; field: string; oldValue: string | null; newValue: string | null; authorName: string | null; agent: string | null }[]`: the `change_log` rows with `entity = 'adr'` and `entity_id = adr.id`, oldest first, capped at 100.
  - `TaskItem` gains `adrs: number[]` (ADR numbers linked to the task).
- [ ] **Step 1: Schema.** Add the table, then run `npm run db:generate -- --name adr-tasks`.
- [ ] **Step 2: Failing tests in `adrs.test.ts`.**
  - `createAdr({ ..., tasks: [t1] })` makes `getAdr(n).tasks` equal `[{ id: t1, ... }]` and `getSystem().tasks[0].adrs` equal `[n]`.
  - `acceptAdr(n)`, then `updateAdr(n, { tasks: [t1, t2] })` succeeds and logs one `task` entry (for t2).
  - `updateAdr(n, { title: "x" })` on the accepted ADR is still `ConflictError`.
  - A task from another project is `NotFoundError`.
  - `getAdr(n).history` has entries for `created`, `status` → `accepted` and `task`, in time order, with `authorName` filled.
  - Deleting t1 removes the link.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/adrs.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Adapters.** In the `create_adr` and `update_adr` descriptions, mention `tasks`: "task ids, may change after acceptance". `get_adr` returns `tasks` and `history`; Part 5's `brief` mode will leave `history` out.
- [ ] **Step 6: UI.**
  - **`adr-view.tsx`:** a "Tasks" panel listing linked tasks (state box + title + system link). A "History" panel shows a vertical timeline of `history` entries: "Proposed by X · date", "Accepted by Y · date", "Linked task #12". Editors get a "Link tasks" `Popover` + `Command` that searches the project's tasks, taken from `systems.list` plus each system's tasks through a new tRPC query `adrs.linkableTasks` (input `P`) that returns `{ id, title, systemSlug }[]`, capped at 500.
  - **`TaskRow`:** small `ADR-0003` link chips for `task.adrs`.
- [ ] **Step 7: Run** `npm test && npm run typecheck && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(adrs): show adr history and link adrs to tasks`.

---

## Self-review notes

- Every scope item has a task: notes and blocked reason (1), estimates and rollups (2), checklists (3), reorder and move (4), dependencies (5), custom fields (6), archive (7), duplicate warning (8), question priority (9), ADR history and links (10).
- **Shared names for later parts:**
  - `rollup`, `systemRollups` and `groupRollups` (Part 8 adds a release grouping).
  - `SystemListItem` gains `fields`, `blockedBy`, `points`, `tasksBlocked` and `archivedAt` (Part 3's card fields and column picker).
  - `listBlockedTasks` (Part 3's My work).
  - `systemFilter.startable` (Part 5 `/next`).
  - `setTaskChecks` and `moveTask` (Part 5's batch tools may wrap them).
- Task order matters only for Task 7's retroactive exclusions: it edits the rollups, blocked-task and dependency queries from Tasks 1, 2 and 5. Tasks 8–10 are independent.
