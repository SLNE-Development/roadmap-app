# roadmap-app v2 Part 8: Insight and reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people see how a project moves over time: a burn-up progress chart with a projected finish, time spent per column category, releases with readiness, slip risk and generated release notes, a decision map, a phase dependency graph, and an activity page that folds noisy bursts, filters on the server and exports CSV.

**Architecture:** Everything historical is rebuilt from `change_log`; no new history tables. Pure functions in `src/lib/insight/*`, `src/lib/chart/*` and `src/lib/graph/*` do the replay, scaling and layout, and are unit-tested without a database. Thin ops in `src/lib/ops/insight.ts`, `src/lib/ops/releases.ts` and `src/lib/ops/decisions.ts` load rows, check access and call them. Charts and graphs are hand-drawn SVG components styled with Tide tokens, so there is no chart library.

**Tech Stack:** as in the v2 index, plus `@dagrejs/dagre` for graph layout (run `npm view @dagrejs/dagre version`, install with `^`; it ships its own types).

**Spec:** none (plans only). Sources: `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` and the 2026-09-30 review artifact's Progress chart, Releases and Decision map proposals.

**Assumed names from earlier parts.** Each is marked *(assumed)* where it's used. If the earlier part's plan named something differently, use that part's name and keep the behaviour described here.
- Part 0: the index on `change_log(project_id, id)`. Dead-code removal deletes `src/lib/progress.ts` `categoryProgress`; don't reuse that file name for anything new.
- Part 2: `system.archivedAt` and `project.archivedAt` (nullable timestamptz). `task.estimate` (`TaskEstimate = "S" | "M" | "L"`, nullable) with `ESTIMATE_POINTS`, the pure `rollup(tasks: { state; estimate }[]): Rollup` (`{ tasks, done, points, pointsDone, unestimated }`), `systemRollups(db, projectId, systemIds?)` and `groupRollups(db, projectId, by)` in `src/lib/ops/rollups.ts`. Releases add their own grouping by calling `rollup()` over the release's tasks. The `adr_task(adrId, taskId)` link table (Drizzle export `adrTask`). A task moved between systems is logged as entity `task`, field `moved`, with old and new values being the source and target system **slugs**, written twice (once with `systemId` = source, once with `systemId` = target).
- Part 4: `evaluateGates(db: Executor, systemId: string, columnId: string): Promise<{ rule: string; ok: boolean; message: string }[]>` in `src/lib/ops/gates.ts`.
- Part 3: the shared chips `FilterChip` and `ToggleChip` in `src/components/filter-chip.tsx` (controlled: `value` + `onChange`), with URL helpers in `src/lib/url-filters.ts`. Use them for every filter in this part, writing the value to the URL with `router.replace`.

## Global Constraints

The Global Constraints of the v2 index apply. In addition:
- **Day buckets are UTC.** Every day key is a `YYYY-MM-DD` string computed in UTC, and the chart axis and tooltips say "UTC". Nothing in this part formats dates in the browser's timezone during render (hydration safety).
- **New change-log vocabulary:**
  - entity `release`, with fields `created`, `name`, `slug`, `targetDate`, `status`, `notes` (newValue `v<N>`), `deleted`
  - entity `system`, field `release` (oldValue and newValue are release names or `null`)
- **Permissions:**
  - Viewers read every chart, graph, release and the CSV export.
  - Editors create and edit releases, assign systems to `planned` releases, and edit release notes.
  - Owners freeze, unfreeze and ship releases, and assign or unassign systems of a `frozen` release.
  - Nobody changes a `shipped` release's scope (409).
- **Agent tools** added here are read-only and short: `get_progress`, `list_releases`, `get_release`, plus a `release` filter on `list_systems` and a `release` field on `update_system`.

## Review Focus

1. **Tasks with no `created` entry** (seeded directly, or created before logging existed): the chart counts them from the project's creation day, and the chart never shows negative, `NaN` or out-of-range values. Pinned in Task 8.2.
2. **A task deleted while done, or moved to another system:** on the deletion day both scope and done drop by one. A moved task is counted once, under its current system, for its whole life. Pinned in Task 8.2.
3. **Zero pace, zero remaining or less than 7 days of history:** the projection is `null` or `"done"`, never an Infinity date or a date in the past. Pinned in Task 8.2.
4. **CSV cells holding commas, quotes, newlines or spreadsheet formulas** (`=HYPERLINK(...)` in a task title written by an agent): exported escaped and neutralised. A non-member gets 404. Pinned in Task 8.15.
5. **A graph with a cycle, an isolated node, or 200 ADRs:** layout finishes without throwing, no two nodes overlap, and the SVG scrolls inside its container instead of widening the page. Pinned in Task 8.10.

---

### Task 8.1: Chart scale and tick helpers

**Files:**
- Create: `src/lib/chart/scale.ts`
- Test: `src/lib/chart/scale.test.ts`

**Interfaces:**
- Produces:
  - `linearScale(domain: [number, number], range: [number, number]): ((value: number) => number) & { invert(px: number): number }`
  - `niceTicks(max: number, target = 4): number[]`: evenly spaced ticks from 0 up to the first value at or above `max`, with a step of 1, 2 or 5 × 10^k
  - `dayKeys(from: Date, to: Date): string[]`: every UTC `YYYY-MM-DD` key from `from` to `to`, inclusive
  - `dayTicks(keys: string[], maxTicks = 5): { index: number; label: string }[]`
  - `addDays(key: string, n: number): string`

- [ ] **Step 1: Write the failing tests** in `scale.test.ts`:
  - `linearScale([0, 200], [180, 10])(0)` is `180`, `(200)` is `10` and `(100)` is `95`. `invert(95)` is `100`.
  - `linearScale([5, 5], [0, 100])(5)` is `0`: a degenerate domain maps to the range start and never returns `NaN`.
  - `niceTicks(164)` is `[0, 50, 100, 150, 200]`, `niceTicks(7)` is `[0, 2, 4, 6, 8]`, `niceTicks(0)` is `[0, 1]`, and `niceTicks(1000)` is `[0, 500, 1000]` (the step is always 1, 2 or 5 × 10^k, never 250).
  - `dayKeys(new Date("2026-09-29T23:30:00Z"), new Date("2026-10-01T00:10:00Z"))` is `["2026-09-29", "2026-09-30", "2026-10-01"]`.
  - `addDays("2026-02-27", 2)` is `"2026-03-01"`.
  - `dayTicks` over 42 keys starting at `2026-09-02` returns at most 5 ticks. The first has `index: 0`, the last has index 41, labels look like `"2 Sep"`, and indexes rise strictly.
- [ ] **Step 2:** Run `npx vitest run src/lib/chart/scale.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `scale.ts`.**
  - `niceTicks`:
    - `raw = max / target`
    - `mag = 10 ** floor(log10(raw))`
    - `step` is the first of `[1, 2, 5, 10] × mag` that is at or above `raw`
    - `top = ceil(max / step) × step`
    - when `max <= 0`, return `[0, 1]`
  - `dayTicks` picks evenly spaced indexes, always including the first and last. Labels are formatted with `Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })`.
  - Doc comment on every export.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(insight): add chart scale and day tick helpers`.

### Task 8.2: Burn-up replay and finish projection

**Files:**
- Create: `src/lib/insight/burnup.ts`
- Test: `src/lib/insight/burnup.test.ts`

**Interfaces:**
- Consumes: `dayKeys`, `addDays` (Task 8.1).
- Produces:
  - `TaskLogEntry = { taskId: number; field: "created" | "state" | "deleted" | "moved"; newValue: string | null; at: Date; logId: number }`
  - `CurrentTask = { id: number; state: TaskState }`
  - `TaskLife = { taskId: number; createdAt: Date; deletedAt: Date | null; states: { at: Date; state: TaskState }[] }`: `states` is sorted and its first entry is at `createdAt`
  - `replayTasks(entries: TaskLogEntry[], current: CurrentTask[], origin: Date): TaskLife[]`
  - `BurnupPoint = { day: string; scope: number; done: number }`
  - `sampleBurnup(lives: TaskLife[], days: string[], now: Date): BurnupPoint[]`
  - `Projection = { status: "done" } | { status: "none"; reason: "no-pace" | "too-little-history" } | { status: "range"; paceLow: number; paceHigh: number; earliest: string; latest: string }`
  - `projectFinish(points: BurnupPoint[]): Projection`

**The replay rules.** Put these in the doc comment of `replayTasks`, word for word:
1. Group `entries` by `taskId` and order each group by `logId`.
2. `createdAt` is the time of the first `created` entry. With none, it's `origin` (the project's `createdAt`).
3. The state at `createdAt` is `todo`. Each `state` entry appends `{ at, state: newValue }`.
4. `deletedAt` is the time of the first `deleted` entry, or `null`. Entries after `deletedAt` are ignored.
5. For a task that still exists (it's in `current`) whose replayed final state differs from `current.state`, append `{ at: time of that task's last log entry, or createdAt when it has none, state: current.state }`. The current row is the ground truth.
6. A task that is in `entries` but neither in `current` nor deleted (its system was removed by cascade) is treated as deleted at its last log entry's time.
7. `systemId` entries don't change counts. Filtering by phase, board, domain or release uses the task's current system, or for a deleted task the system of its last log entry (the caller resolves that before calling).

**Sampling.** A day's value is taken at the end of the UTC day (`23:59:59.999Z`), or at `now` for the day that contains `now`. `scope` counts tasks with `createdAt <= t` and (`deletedAt` is `null` or `deletedAt > t`). `done` counts those whose last state at or before `t` is `done`.

**Projection** uses the last point `L` and the point 14 days earlier `E`, or the earliest point when there are 7 to 13 days.
- Fewer than 7 days: `{ status: "none", reason: "too-little-history" }`.
- `remaining = L.scope − L.done`. When it's `<= 0`: `{ status: "done" }`.
- `pace = (L.done − E.done) / days`. When it's `<= 0`: `{ status: "none", reason: "no-pace" }`.
- Otherwise:
  - `paceHigh = pace × 1.15`, `paceLow = pace × 0.8`
  - `earliest = addDays(L.day, ceil(remaining / paceHigh))`
  - `latest = addDays(L.day, ceil(remaining / paceLow))`

- [ ] **Step 1: Write the failing tests.** Use times on `2026-09-01..2026-09-30`, and `origin = 2026-09-01T08:00Z`.
  - Created 09-02, set to done 09-05: on 09-04 `{scope 1, done 0}`; on 09-05 `{scope 1, done 1}`.
  - No log entries, `current` state `done`: on 09-01 `{scope 1, done 1}` (rules 2 and 5).
  - Created 09-02, done 09-03, deleted 09-06: 09-05 `{1,1}`, 09-06 `{0,0}`.
  - Created 09-02 with a `systemId` entry on 09-04: scope stays 1 throughout.
  - Log says `doing` but `current` says `todo` (a lost entry): after the last entry the task counts as not done.
  - Present in `entries`, absent from `current`, no `deleted` entry: treated as deleted at its last entry (rule 6).
  - Two `created` entries for the same id (a plan rewrite re-logging): only the first counts.
  - `now = 2026-09-10T12:00Z` with a state change at 13:00 the same day: the 09-10 point doesn't include it.
  - `projectFinish`:
    - 20 days with done rising 1 per day from 0 and scope fixed at 40 gives `{ status: "range" }`. Pace is 1, so `paceHigh` is 1.15 and `paceLow` is 0.8. Remaining is 21 (scope 40 minus done 19 on the last day), so `earliest = addDays(last, 19)` and `latest = addDays(last, 27)`.
    - Flat done gives `no-pace`, 5 points give `too-little-history`, and done = scope gives `done`.
    - Every result is either not a range or has `earliest >= L.day`.
  - Property check: for random sequences of 200 entries generated with a seeded PRNG in the test, every point has `0 <= done <= scope` and finite numbers.
- [ ] **Step 2:** Run `npx vitest run src/lib/insight/burnup.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `replayTasks`, `sampleBurnup` and `projectFinish` as specified. Sampling is `O(tasks × days)`, which is fine at the expected sizes (hundreds of tasks, at most 365 days).
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(insight): replay task history into burn-up points and a finish range`.

### Task 8.3: Progress op, procedure and `get_progress` tool

**Files:**
- Create: `src/lib/ops/insight.ts`
- Test: `src/lib/ops/insight.test.ts`
- Create: `src/server/trpc/routers/insight.ts`
- Modify: `src/server/trpc/router.ts` (register `insight`), `src/lib/tools/definitions.ts`

**Interfaces:**
- Consumes: `replayTasks`, `sampleBurnup`, `projectFinish` (Task 8.2), `dayKeys` (Task 8.1), `projectAccess`, and `system.archivedAt` *(assumed, Part 2)*. The release filter reads `system.releaseId`, which Task 8.6 adds. Until then, accept the `release` key but ignore it, and Task 8.6 wires it up.
- Produces:
  - `progressInput = z.object({ days: z.union([z.literal(14), z.literal(42), z.literal(90), z.literal(180), z.literal(365)]).default(42), phase: z.string().optional(), board: z.string().optional(), domain: z.string().optional(), release: z.string().optional() })`. `phase` and `domain` are ids, `board` and `release` are slugs.
  - `getProgress(db, actor, slug, raw): Promise<{ points: BurnupPoint[]; projection: Projection; scopeAdded: number; totals: { scope: number; done: number } }>`
    - `scopeAdded` is the last point's scope minus the first point's.
  - tRPC `insight.progress({ project, filter })`
  - tool `get_progress`: input `{ project, ...progressInput.shape, series: z.boolean().default(false) }`; `GET /projects/:project/progress`. It returns `{ totals, scopeAdded, projection }`, plus `points` only when `series` is true.

- [ ] **Step 1: Write the failing tests** with `createTestDb`, `createProjectFixture` and the real ops `createSystem`, `addTask`, `updateTask`, `deleteTask`:
  - A project with 3 tasks, one set to done: the last point is `{scope: 3, done: 1}`.
  - A deleted task isn't in the last point.
  - A `phase` filter counts only tasks of systems in that phase.
  - An archived system's tasks are excluded *(assumed field)*.
  - A viewer can read it, and a non-member gets `NotFoundError`.
  - `days: 14` returns 14 points ending today, where today is computed from the injectable `now`: add an optional last parameter `now: Date = new Date()` to `getProgress` for tests.
- [ ] **Step 2:** Run `npx vitest run src/lib/ops/insight.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `getProgress`.**
  - Load the current tasks joined to system, with `projectId = project.id` and the non-archived filters applied.
  - Load the change-log rows with `projectId = project.id AND entity = 'task' AND field IN ('created', 'state', 'deleted', 'moved')`, ordered by id. Select only `id, entityId, field, newValue, createdAt, systemId`.
  - For deleted tasks, resolve the system from their last entry's `systemId`, and apply the same filters against the current system rows (a missing system is excluded when any filter is set).
  - `origin` is `project.createdAt`. The window is `dayKeys(max(origin, now − (days−1) days), now)`.
- [ ] **Step 4: Add the procedure and the tool**, keeping the tool description to one sentence: "Task burn-up totals and a projected finish range; set series for daily points."
- [ ] **Step 5:** Run `npx vitest run src/lib/ops/insight.test.ts src/lib/tools`. Expected: PASS, including the tool registry test that lists every tool.
- [ ] **Step 6: Commit** `feat(insight): serve task burn-up and projection to the UI and agents`.

### Task 8.4: Time in column category

**Files:**
- Create: `src/lib/insight/column-time.ts`
- Test: `src/lib/insight/column-time.test.ts`
- Modify: `src/lib/ops/insight.ts`, `src/server/trpc/routers/insight.ts`

**Interfaces:**
- Produces:
  - `timeInCategory(input: { createdAt: Date; moves: { at: Date; to: ColumnCategory | "unknown" }[]; now: Date }): Record<ColumnCategory | "unknown", number>`: milliseconds per category
  - `getColumnTimes(db, actor, slug, raw: { board?: string }): Promise<{ systems: { slug: string; title: string; current: ColumnCategory; currentSinceMs: number; byCategory: Record<…, number> }[]; medians: Record<ColumnCategory, number | null> }>`
  - tRPC `insight.columnTimes`

- [ ] **Step 1: Write the failing tests.**
  - Created 09-01, moved to active on 09-03, review 09-05, done 09-06, now 09-10: planning 2 days, active 2, review 1, done 4 (in ms).
  - No moves: all time is in `planning`, because systems start in the planning column (see `createSystem`).
  - A move whose `"Board / Column"` name no longer resolves: counts as `unknown`.
  - The op test: two systems moved through the real `moveSystem` produce `medians.active` equal to the median of their active times, and `medians.review` is `null` when no system has been in review.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Moves come from change-log rows with `entity = 'system' AND field = 'column'`, whose `newValue` is `"<Board name> / <Column name>"` (see `moveSystem`). Resolve them to a category by exact match against the project's current boards and columns, and fall back to `unknown`.
  - Document this limit: renaming a column after a move makes older moves `unknown`.
  - Sort `systems` by `currentSinceMs` descending, so the stuck ones come first.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(insight): measure time systems spend in each column category`.

### Task 8.5: Burn-up chart and the Progress view of the roadmap page

**Files:**
- Create: `src/components/insight/burnup-chart.tsx`, `src/components/insight/stat-tiles.tsx`, `src/components/insight/column-times.tsx`, `src/app/(app)/p/[project]/roadmap/progress-view.tsx`
- Modify: `src/app/(app)/p/[project]/roadmap/page.tsx`, `src/app/(app)/p/[project]/roadmap/roadmap-view.tsx`
- Test: `src/components/insight/burnup-chart.test.tsx`

**Interfaces:**
- Consumes: `insight.progress`, `insight.columnTimes`, `linearScale`, `niceTicks` and `dayTicks` (Task 8.1), `FilterChip` / `ToggleChip` (Part 3), and `SegmentedLinks` from `src/components/activity/url-tabs.tsx`.
- Produces:
  - `<BurnupChart points projection width? />`, with a default `viewBox` of `560×220` and margins `L 34, R 14, T 12, B 26`, as in the review mockup.
  - The roadmap page reads `?view=rail|graph|progress` (default `rail`). `graph` is filled in by Task 8.12; until then it renders the rail.

- [ ] **Step 1: Write the failing component test** with `react-dom/server` `renderToStaticMarkup`, the way `src/components/markdown.test.tsx` does:
  - For 3 points `{scope 10, done 2..4}` with no projection, the markup contains one `<path` with class `stroke-primary` whose `d` starts at `M34 `.
  - Y tick labels are `0, 5, 10` (from `niceTicks(10)` = `[0, 5, 10]`).
  - There is a `<table class="sr-only">` with 3 rows.
  - `role="img"` and an `aria-label` include "done 4 of 10".
  - With `projection.status === "range"`, a `<polygon` with class `fill-primary/15` exists.
- [ ] **Step 2:** Run `npx vitest run src/components/insight`. Expected: FAIL.
- [ ] **Step 3: Implement the chart.**
  - The x domain is `[0, points.length − 1 + extraDays]`, where `extraDays` is the days from the last point to `projection.latest`, when there's a range.
  - Draw these marks:
    - horizontal grid lines at `niceTicks(max(scope))` with `stroke-border`
    - y labels and x day labels in `fill-muted-foreground text-[10.5px]`
    - the done area `fill-primary/10`
    - the scope line `stroke-muted-foreground`, 1.75
    - the done line `stroke-primary`, 2.25
    - a today marker, dashed `stroke-border`
    - the projection triangle from today's done point to `(earliest, scope)` and `(latest, scope)` as a `fill-primary/15` polygon, with a dashed scope continuation
  - The legend sits under the chart.
  - Hovering a column band shows a small tooltip with the day, scope and done. Keyboard users get the same numbers from the hidden table.
- [ ] **Step 4: Build the Progress view.**
  - `StatTiles` shows three tiles: `done / scope tasks done`, `+N scope added in <range>`, and the projected finish as `20–29 Oct`, `Done` or `Not enough pace yet`.
  - Filters: phase, board, domain and release chips via `FilterChip`, plus a range segmented control (2 weeks / 6 weeks / 3 months / 6 months / 1 year) in the URL as `days`.
  - `ColumnTimes` is a table of the 10 systems with the longest `currentSinceMs`: system, current category chip, "in category for 6 d", and a thin stacked bar of `byCategory` in `cat-*` colours. Durations are formatted as days, with one decimal under 2 days.
- [ ] **Step 5: Change the roadmap page.** The page header gets `SegmentedLinks` for Rail / Graph / Progress, `page.tsx` prefetches `insight.progress` and `insight.columnTimes` when `view=progress`, and the axis caption says "Days in UTC".
- [ ] **Step 6:** Run `npx vitest run src/components/insight`, `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(roadmap): add progress view with burn-up chart and column times`.

### Task 8.6: Release schema and scope ops

**Files:**
- Modify: `src/db/schema/content.ts` (tables `release` and `releaseNote`, column `system.releaseId`), `src/db/schema/index.ts`
- Generated: migration via `npm run db:generate -- --name releases`
- Create: `src/lib/ops/releases.ts`
- Test: `src/lib/ops/releases.test.ts`
- Modify: `src/lib/ops/systems.ts` (`updateSystemInput.release`, `systemFilter.release`, `SystemListItem.releaseSlug` / `releaseName`), `src/lib/ops/insight.ts` (release filter)

**Interfaces:**
- Produces:
  - Table `release`:
    - `id` text pk
    - `projectId` fk cascade
    - `slug` text (unique with projectId, constraint `release_project_slug`)
    - `name` text
    - `targetDate` `date("target_date", { mode: "string" })`, nullable
    - `status` text enum `RELEASE_STATUSES = ["planned", "frozen", "shipped"] as const`, default `planned`
    - `frozenAt`, `shippedAt` timestamptz nullable
    - `createdAt`
  - Table `release_note`:
    - `id`
    - `releaseId` fk cascade
    - `version` integer
    - `body` text
    - `authorUserId` fk set null
    - `agent` text
    - `createdAt`
    - unique `(releaseId, version)` as `release_note_version`
  - `system.releaseId` text, fk `release.id` on delete set null, plus an index `system_release_idx`.
  - The ops:
    - `createReleaseInput = { slug: slugSchema, name: z.string().trim().min(1).max(80), targetDate: z.iso.date().nullable().optional() }`, and `createRelease(db, actor, projectSlug, raw)`, which is editor
    - `updateReleaseInput` (all optional), and `updateRelease(db, actor, projectSlug, releaseSlug, raw)`, which is editor; changing `targetDate` or `name` of a `frozen` release needs owner
    - `freezeRelease` / `unfreezeRelease(db, actor, projectSlug, releaseSlug)`, which are owner
    - `deleteRelease`, which is owner and allowed only while `planned`; systems are unassigned by the fk
    - `findRelease(tx, projectId, slug)`
  - `updateSystem` accepts `release: slugSchema.nullable().optional()`.

- [ ] **Step 1: Write the failing tests.**
  - An editor creates `1-0` and assigns a system: the list item shows `releaseSlug: "1-0"`, and the change log has an entry with entity `system`, field `release` and newValue `1.0` (the release name).
  - A duplicate slug gives `ConflictError`.
  - After an owner freezes: an editor assigning another system gets `ForbiddenError` "1.0 is frozen; only an owner can change its scope.", while an owner assigning it succeeds and logs normally.
  - An editor removing a system from a frozen release gets `ForbiddenError`.
  - Any assignment to a `shipped` release gives `ConflictError`.
  - `listSystems({ release: "1-0" })` returns only its systems.
  - `unfreezeRelease` by an editor gives `ForbiddenError`.
  - `deleteRelease` on a frozen release gives `ConflictError`.
  - A non-member gets `NotFoundError`.
- [ ] **Step 2:** Run `npx vitest run src/lib/ops/releases.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Edit the schema, then run `npm run db:generate -- --name releases`. Check that the SQL creates both tables, the column and the index.
- [ ] **Step 4: Implement the ops.**
  - Lock the release row with `.for("update")` in every op that changes its status or scope, so a freeze and an assignment serialise.
  - Log each changed field with entity `release`.
  - The system assignment lives in `updateSystem` and checks the target release and the previous release, both under the rules above.
  - `getProgress` resolves `release` to an id and filters the systems.
- [ ] **Step 5:** Run it. Expected: PASS. Then run `npx vitest run src/lib/ops` for regressions.
- [ ] **Step 6: Commit** `feat(releases): add releases with scope freeze rules`.

### Task 8.7: Readiness, slip risk, shipping and release notes

**Files:**
- Create: `src/lib/insight/release-notes.ts`
- Test: `src/lib/insight/release-notes.test.ts`
- Modify: `src/lib/ops/releases.ts`, `src/lib/ops/releases.test.ts`

**Interfaces:**
- Consumes:
  - `rollup` (Part 2)
  - `evaluateGates` *(assumed, Part 4)*
  - `getProgress` with `release`
  - `projectFinish`
  - `latestUpdates(db, projectId)` from `src/lib/ops/updates.ts`
- Produces:
  - `composeReleaseNotes(input: { name: string; shippedOn: string; shipped: { title: string; summary: string; lastUpdate: string | null }[]; decisions: { number: number; title: string }[]; notShipped: { title: string }[] }): string`, which returns markdown.
  - `getRelease(db, actor, projectSlug, releaseSlug): Promise<ReleaseDetail>`, where `ReleaseDetail` holds:
    - the release row
    - `systems` (slug, title, category, ownerName, tasksDone, tasksTotal, and `gatesUnmet` as the count of failing rules)
    - `counts` per category
    - `estimates` (the rollup)
    - `openQuestions`, the unresolved questions on its systems
    - `risk: "on-track" | "at-risk" | "late" | "unknown"`
    - `projection` (a `Projection`)
    - `latestNote: { version: number; body: string } | null`
  - `listReleases(db, actor, projectSlug)`, which returns the rows with `{ systemCount, doneCount }`, ordered by `targetDate` nulls last, then name.
  - `shipReleaseInput = { unfinished: z.enum(["block", "unassign"]).default("block") }`, and `shipRelease(db, actor, projectSlug, releaseSlug, raw)`, which is owner.
  - `writeReleaseNote(db, actor, projectSlug, releaseSlug, body)` (editor) and `getReleaseNote(db, actor, projectSlug, releaseSlug, version?)`.

- [ ] **Step 1: Write the failing tests.**
  - `composeReleaseNotes` with 2 shipped systems, 1 decision and 1 not shipped, name "1.0" and shippedOn "2026-10-24":

    ```
    # 1.0

    Shipped 24 Oct 2026.

    ## Shipped

    - **Search**: Find anything in one box.
    - **Billing exports**: CSV and PDF invoices.

    ## Decisions

    - ADR-0004 Use SSE for live boards

    ## Not shipped

    - Mobile app
    ```

    Empty sections are left out. A system with an empty summary uses its last update's first line, and with neither it's just the title. Markdown characters in titles aren't escaped, because they're written by project members.
  - `getRelease`:
    - With target `2026-10-24` and projection `{earliest 2026-10-20, latest 2026-10-29}`, `risk` is `"at-risk"`.
    - When `latest <= target` it's `"on-track"`; when `earliest > target` it's `"late"`; with no projection or no target it's `"unknown"`; after shipping it's always `"on-track"`.
    - `gatesUnmet` counts the rules failing for the board's first `done` column *(assumed `evaluateGates`)*.
  - `shipRelease`:
    - With 1 unfinished system and `unfinished: "block"`, it gives `ConflictError` "2 of 3 systems aren't done: Mobile app. Ship with unfinished: unassign to move them out."
    - With `"unassign"`, the system's `releaseId` becomes null and is logged, the status becomes `shipped`, `shippedAt` is set, and note version 1 exists with the composed body.
    - Shipping twice gives `ConflictError`.
  - `writeReleaseNote`: two writes create versions 2 and 3, and `getReleaseNote(v2)` returns version 2. Two concurrent writes get distinct versions: lock the release row, the same pattern as `appendVersion` in `documents.ts`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.** Decisions are the accepted ADRs linked through `adr_system` to any shipped system, deduplicated and sorted by number.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(releases): add readiness, slip risk, shipping and versioned release notes`.

### Task 8.8: Release procedures, tools and the `/next` preference

**Files:**
- Create: `src/server/trpc/routers/releases.ts`
- Modify: `src/server/trpc/router.ts`, `src/lib/tools/definitions.ts`, `plugin/commands/next.md`, and the plugin skill `plugin/skills/using-surf-roadmap/SKILL.md` (tool list line)
- Test: `src/server/trpc/router.test.ts` (add cases), `src/lib/tools/registry.test.ts` (tool names)

**Interfaces:**
- Produces:
  - tRPC `releases.list`, `releases.get`, `releases.create`, `releases.update`, `releases.freeze`, `releases.unfreeze`, `releases.ship`, `releases.delete`, `releases.note` (a query with `version?`) and `releases.writeNote`
  - tools `list_releases` (GET `/projects/:project/releases`, "List releases with target date, status and done counts.") and `get_release` (GET `/projects/:project/releases/:release`, "A release's readiness: systems, open questions, unmet gates, slip risk."). `get_release` leaves out `latestNote.body` unless `notes: true`.
  - `list_systems` gains `release`, and `update_system` gains `release`, through the op schemas.

- [ ] **Step 1: Write the failing tests.** The router caller creates and freezes a release. The registry test expects `list_releases` and `get_release`, and a REST GET of `/api/v1/projects/demo/releases` returns 200 with an array (use the existing `rest.test.ts` harness).
- [ ] **Step 2:** Run `npx vitest run src/server/trpc src/lib/tools`. Expected: FAIL.
- [ ] **Step 3: Implement the procedures and tools.**
- [ ] **Step 4: Update `plugin/commands/next.md`.** After "find candidate tasks", add: "Prefer tasks of systems in the nearest unshipped release (`list_releases`, earliest target date first); only then fall back to phase order." Keep the rest unchanged.
- [ ] **Step 5:** Run `npx vitest run src/server/trpc src/lib/tools` and `npm run test:plugin`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(releases): expose releases to the web UI, agents and /next`.

### Task 8.9: Releases UI

**Files:**
- Create:
  - `src/app/(app)/p/[project]/releases/page.tsx` and `releases-view.tsx`
  - `src/app/(app)/p/[project]/releases/[release]/page.tsx` and `release-view.tsx`
  - `src/components/releases/new-release-dialog.tsx`, `ship-release-dialog.tsx`, `release-notes.tsx` and `release-select.tsx`
- Modify:
  - `src/components/shell/app-sidebar.tsx` (the "Releases" item after Roadmap, icon `Rocket`, count of unshipped releases)
  - `src/lib/ops/summaries.ts` (the `counts.releases` it needs)
  - `src/components/system/properties.tsx` (the Release property with `ReleaseSelect`)
  - `src/components/systems/systems-toolbar.tsx` (the release filter)
  - `src/components/command-menu.tsx` or `src/components/shell/command-menu.tsx` (the Releases page entry)

**Interfaces:**
- Consumes: the `releases.*` procedures (Task 8.8), `BurnupChart` (Task 8.5, with `release` passed to `insight.progress`), `VersionPicker`, `Markdown`, `FilterChip` (Part 3).

- [ ] **Step 1: Build the list page.**
  - It's a table of releases: name, target date, status chip (planned = `cat-todo`, frozen = `cat-review`, shipped = `cat-done`), a done/total progress bar and the risk chip.
  - Editors get a "New release" button opening `NewReleaseDialog`: name, slug auto-derived until edited, and an optional target date as `Input type="date"`.
  - With no releases, show an `EmptyState`: "Releases group systems that ship together. Create one, then assign systems from their page."
- [ ] **Step 2: Build the detail page** per the review mockup.
  - The header shows "1.0 · target 24 Oct" and "Frozen 28 Sep by Ammo · 24 days left", computed with the server clock via `useNow`.
  - Three stat tiles: systems done, open questions, and risk with its projected finish.
  - A stacked category bar.
  - A "Not done yet" list with each row's category chip, detail line (task counts or "2 of 3 Done rules met") and owner.
  - A burn-up chart of this release.
  - A notes tab: `VersionPicker` over the versions, `Markdown` rendering, and an editor-only "Edit notes" button that opens a textarea with preview and saves through `releases.writeNote`.
  - Owner-only actions: Freeze / Unfreeze, and Ship. `ShipReleaseDialog` lists the unfinished systems and offers "Move them out and ship" (`unfinished: "unassign"`) or Cancel. This follows the `alert-dialog` pattern already used for deleting a project.
- [ ] **Step 3: Add the system property.** `ReleaseSelect` lists the planned and frozen releases, plus "No release". Frozen ones are disabled for non-owners with the hint "Frozen: ask an owner". It's hidden when the project has no releases.
- [ ] **Step 4: Add the systems table filter** `release` via `FilterChip`, and show a release column when any release exists.
- [ ] **Step 5:** Run `npm run typecheck`, `npm run lint` and `npm test`. Then use the `run` skill to click through creating, assigning, freezing and shipping in the dev server. Expected: all green, and the flow works.
- [ ] **Step 6: Commit** `feat(releases): add release pages, system release property and filters`.

### Task 8.10: Graph layout and `GraphView`

**Files:**
- Create: `src/lib/graph/layout.ts`, `src/components/graph/graph-view.tsx`
- Test: `src/lib/graph/layout.test.ts`
- Modify: `package.json` / `package-lock.json` (`@dagrejs/dagre`)

**Interfaces:**
- Produces:
  - `GraphNodeInput = { id: string; width: number; height: number }`, `GraphEdgeInput = { from: string; to: string; kind: string }`
  - `layoutGraph(input: { nodes: GraphNodeInput[]; edges: GraphEdgeInput[]; direction: "LR" | "TB" }): { nodes: (GraphNodeInput & { x: number; y: number })[]; edges: (GraphEdgeInput & { points: { x: number; y: number }[] })[]; width: number; height: number }`
    - `x` and `y` are the top-left corners.
    - Node spacing is `nodesep 24`, `ranksep 56` and `marginx/y 16`.
    - Edges whose endpoint is missing are dropped.
  - `<GraphView layout nodeHref(id) renderNode(node) edgeClassName(kind) label />`: an SVG sized to the layout inside `<div className="overflow-auto border bg-card">`. Every node is an `<a href>` with an `aria-label`, and edges are `<path>` with an arrow marker, using `stroke-border` and a per-kind class.

- [ ] **Step 1: Install** the package with `npm install @dagrejs/dagre@^<latest>`.
- [ ] **Step 2: Write the failing tests.**
  - A chain A→B→C with `LR`: `x(A) < x(B) < x(C)`.
  - A cycle A→B→A doesn't throw and returns 2 nodes.
  - An isolated node D is placed inside `width` and `height`.
  - 200 nodes of 200×44 with random edges from a seeded PRNG: no two rectangles overlap, and everything is within the bounds.
  - An edge to a missing node is dropped.
  - The same input twice gives identical output.
- [ ] **Step 3:** Run `npx vitest run src/lib/graph`. Expected: FAIL.
- [ ] **Step 4: Implement** with `new dagre.graphlib.Graph()`, `setGraph({ rankdir, nodesep, ranksep, marginx, marginy })`, `setDefaultEdgeLabel(() => ({}))` and `dagre.layout(g)`. Convert dagre's centre coordinates to top-left.
- [ ] **Step 5:** Run it. Expected: PASS.
- [ ] **Step 6: Commit** `feat(graph): add dagre graph layout and an SVG graph view`.

### Task 8.11: Decision map

**Files:**
- Create: `src/lib/ops/decisions.ts`, `src/app/(app)/p/[project]/adrs/map/page.tsx`, `src/app/(app)/p/[project]/adrs/map/decision-map-view.tsx`
- Test: `src/lib/ops/decisions.test.ts`
- Modify: `src/server/trpc/routers/adrs.ts` (`adrs.graph`), `src/app/(app)/p/[project]/adrs/adrs-view.tsx` (a List / Map `SegmentedLinks` in the header)

**Interfaces:**
- Consumes: `layoutGraph`, `GraphView` (Task 8.10), and `adrTask` *(assumed, Part 2)*.
- Produces:
  - `decisionGraphInput = { systems: z.boolean().default(true), tasks: z.boolean().default(false), status: z.enum(ADR_STATUSES).optional() }`
  - `getDecisionGraph(db, actor, slug, raw): Promise<{ nodes: ({ kind: "adr"; id: string; number: number; title: string; status: AdrStatus } | { kind: "system"; id: string; slug: string; title: string; category: ColumnCategory } | { kind: "task"; id: string; taskId: number; title: string; systemSlug: string })[]; edges: { from: string; to: string; kind: "supersedes" | "concerns" | "task" }[] }>`
  - Edges:
    - `supersedes` goes from the newer ADR to the one it supersedes (`adr.supersedesId`)
    - `concerns` goes from ADR to system
    - `task` goes from ADR to task
  - Node ids are prefixed: `adr:<id>`, `sys:<id>`, `task:<id>`.

- [ ] **Step 1: Write the failing tests.**
  - ADR 1 superseded by ADR 2, and ADR 2 linked to system `search`: nodes are adr 1, adr 2 and system search. Edges are `adr:2 → adr:1` (supersedes) and `adr:2 → sys:search` (concerns).
  - With `systems: false`, the system node and its edge are gone.
  - With `status: "accepted"`, only accepted ADRs are left, plus only the systems they link to.
  - A viewer can read it, and a non-member gets `NotFoundError`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement the op and the procedure.** Build the page:
  - Toggles "Systems" and "Tasks", and a status filter, all in the URL.
  - ADR nodes are 200×44, showing `ADR-0004` in mono plus the title truncated with a `<title>` tooltip. The status sets the border: proposed `cat-review`, accepted `cat-done`, superseded `muted`, dashed.
  - System nodes are 160×36 with a category dot, and task nodes are 180×32.
  - Supersedes edges are solid `stroke-fg-2`, and concerns and task edges are dashed `stroke-border`.
  - Clicking goes to `/adrs/<number>`, `/systems/<slug>`, or `/systems/<slug>?tab=overview#task-<id>`.
  - With no ADRs, show an empty state that links back to the list.
- [ ] **Step 4:** Run `npx vitest run src/lib/ops/decisions.test.ts`, then typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(adrs): add a decision map of supersedes chains and linked work`.

### Task 8.12: Phase dependency graph on the roadmap page

**Files:**
- Create: `src/app/(app)/p/[project]/roadmap/phase-graph.tsx`
- Test: `src/app/(app)/p/[project]/roadmap/phase-graph.test.ts`
- Modify: `src/app/(app)/p/[project]/roadmap/roadmap-view.tsx`

**Interfaces:**
- Consumes: `structure.phases` (each phase has `dependsOn: string[]`), `systems.list`, `layoutGraph`, `GraphView`.
- Produces: `phaseGraphInput(phases, systems): { nodes: GraphNodeInput[]; edges: GraphEdgeInput[] }`, a pure function exported for the test.

- [ ] **Step 1: Write the failing test.** For phases P1, P2 (depends on P1) and P3 (depends on P1 and P2), there are 3 edges pointing from the dependency to the dependant (P1→P2, P1→P3, P2→P3), and every node is 220×56. A dependency on an unknown phase id is dropped.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement `PhaseGraph`.**
  - Direction `LR`.
  - A node shows the phase number, name and a done/total bar, with a filled `cat-done` border when complete and a `primary` border on the current ("now") phase, the same rule as the rail.
  - Clicking goes to `/p/<slug>/systems?phase=<id>`.
  - Render it when `view=graph`.
  - With fewer than 2 phases or no dependencies, show the text "No phase dependencies yet. Add them in Settings → Structure." with the rail below.
- [ ] **Step 4:** Run it. Expected: PASS, then typecheck and lint.
- [ ] **Step 5: Commit** `feat(roadmap): draw the phase dependency graph`.

### Task 8.13: Activity filters on the server

**Files:**
- Modify: `src/lib/ops/activity.ts`, `src/lib/ops/activity.test.ts`, `src/lib/ops/updates.ts` (`listUpdatesInput`), `src/lib/ops/updates.test.ts`, `src/app/(app)/p/[project]/activity/page.tsx`, `src/app/(app)/p/[project]/activity/activity-view.tsx`
- Create: `src/lib/activity-groups.ts`

**Interfaces:**
- Produces:
  - `ACTIVITY_GROUPS`, the entity groups and their change-log entities:

    | Group | Entities |
    | --- | --- |
    | `systems` | `system` |
    | `tasks` | `task` |
    | `documents` | `document`, `planning` |
    | `decisions` | `adr` |
    | `questions` | `question` |
    | `structure` | `board`, `column`, `domain`, `phase`, `project`, `release` |
    | `members` | `member` |

    Each group is labelled Systems, Tasks, Documents, Decisions, Questions, Structure and Members.
  - `activityFilter` gains:
    - `person: z.string().optional()`: a user id
    - `agents: z.enum(["only", "exclude"]).optional()`
    - `groups: z.array(z.enum(ACTIVITY_GROUP_KEYS)).optional()`
    - `before: z.number().int().positive().optional()`: the id cursor
  - `listUpdatesInput` gains `person` and `agents` with the same meaning.
  - URL params: `person=<userId>`, `agents=only|exclude`, `groups=tasks,systems`. The old `agents=1` maps to `only`, and an old `person=<name>` that isn't a user id falls back to matching the name client-side, kept for old links.

- [ ] **Step 1: Write the failing tests.**
  - Seed changes by owner, by an editor, and by an actor with `agent: "Claude Code"`.
  - `person` returns only that user's entries.
  - `agents: "only"` returns only the agent's, and `"exclude"` returns none of them.
  - `groups: ["tasks"]` returns only `task` entries.
  - `before` returns entries with a smaller id.
  - The updates filter behaves the same way.
- [ ] **Step 2:** Run `npx vitest run src/lib/ops/activity.test.ts src/lib/ops/updates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with SQL conditions:
  - `person` is `author_user_id = $1`.
  - `agents` is `agent IS NOT NULL` or `agent IS NULL`.
  - `groups` is `entity IN (…)`.
  - `before` is `id < $1`.
- [ ] **Step 4: Change the page.**
  - Move the filters onto `FilterChip` (Part 3): Person (from `members.list`), Agents (only / exclude) and Kind groups.
  - A "Load older" button fetches with `before` set to the oldest id shown, using `useInfiniteQuery` over `history.activity`.
  - Remove the client-side name filter except for the legacy fallback.
- [ ] **Step 5:** Run the same tests, then typecheck and lint. Expected: PASS.
- [ ] **Step 6: Commit** `feat(activity): filter activity by person, agent and kind on the server`.

### Task 8.14: Fold noisy bursts

**Files:**
- Create: `src/components/activity/fold.ts`, `src/components/activity/folded-row.tsx`
- Test: `src/components/activity/fold.test.ts`
- Modify: `src/components/activity/timeline.tsx` (render groups), `src/app/(app)/p/[project]/activity/activity-view.tsx`, `src/components/system/activity-feed.tsx`

**Interfaces:**
- Produces:
  - `FoldedGroup = { kind: "fold"; key: string; authorName: string; agent: string | null; items: ChangeTimelineItem[]; systemTitles: string[]; from: string; to: string }`
  - `foldActivity(items: TimelineItem[], opts?: { windowMs?: number; minRun?: number }): (TimelineItem | FoldedGroup)[]`, where `windowMs` defaults to `300_000` and `minRun` to `3`

**Rules** (put them in the doc comment):
- The input is sorted newest first.
- A run is a maximal sequence of `change` items with the same `authorName` and `agent`, where each item is within `windowMs` of its neighbour and all fall on the same UTC day.
- A `update` item always breaks a run and is never folded.
- Runs shorter than `minRun` stay as they are.

- [ ] **Step 1: Write the failing tests.**
  - 5 changes by "Claude Code for Ammo" 1 minute apart fold into 1 group of 5, whose key is `f-<first item key>`.
  - The same 5 with a gap of 6 minutes after the second give 2 plain items and then a group of 3.
  - An update in the middle of a run splits it.
  - Two different agents for the same person give no fold.
  - A run across UTC midnight is split at midnight.
  - `systemTitles` lists the distinct systems in order of first appearance.
- [ ] **Step 2:** Run `npx vitest run src/components/activity/fold.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `foldActivity` and `FoldedRow`.**
  - The row shows the avatar, name and agent tag, then "made 12 changes to search-index" when one system is involved, or "made 12 changes across 3 systems" otherwise, and the time range "18:02–18:07".
  - A toggle button with `aria-expanded` reveals the original rows, indented.
  - Folding runs after grouping by day in `Timeline`.
  - The system activity feed uses the same function.
- [ ] **Step 4:** Run the fold test, the timeline tests (`change-sentence.test.ts`), typecheck and lint. Expected: PASS.
- [ ] **Step 5: Commit** `feat(activity): fold bursts of changes by the same author`.

### Task 8.15: Activity CSV export

**Files:**
- Create: `src/lib/csv.ts`, `src/app/api/projects/[project]/activity/csv/route.ts`
- Test: `src/lib/csv.test.ts`, `src/app/api/projects/[project]/activity/csv/route.test.ts`
- Modify: `src/app/(app)/p/[project]/activity/activity-view.tsx` (an "Export CSV" link carrying the current filters)

**Interfaces:**
- Consumes: `listActivity` with `before` paging (Task 8.13), `sessionActor()` and `bearerActor(request)` from `src/lib/auth/actor.ts`, and `statusOf` / `messageOf`.
- Produces:
  - `csvCell(value: string | number | null): string` and `csvRow(values: (string | number | null)[]): string` (ends in `\r\n`)
  - `GET /api/projects/:project/activity/csv?person&agents&groups&system`: `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>-activity-<YYYY-MM-DD>.csv"`
  - Columns: `id, created_at, author, agent, entity, entity_id, system, field, old_value, new_value`

- [ ] **Step 1: Write the failing tests.**
  - `csvCell`:
    - `csvCell("plain")` is `plain`.
    - `csvCell('a,"b"')` is `"a,""b"""`.
    - `csvCell("line1\nline2")` is `"line1\nline2"`, quoted.
    - `csvCell("=HYPERLINK(1)")` is `'=HYPERLINK(1)`, prefixed with `'`. The same prefix applies to values starting with `+`, `-`, `@`, tab or CR. A value that needs both gets the prefix and quotes.
    - `csvCell(null)` is empty, and `csvCell(42)` is `42`.
  - The route test builds the request with a session stub, the way `src/app/api/mcp/route.test.ts` injects its actor:
    - As a viewer, 1,203 seeded changes produce 1,204 lines (a header plus the rows) in id-descending order.
    - A non-member gets 404 with JSON `{ error }`.
    - No session and no bearer key gets 401.
    - `groups=tasks` exports only task rows.
- [ ] **Step 2:** Run `npx vitest run src/lib/csv.test.ts "src/app/api/projects"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The route resolves the actor from the session first and falls back to the bearer key, then checks access once with `projectAccess(db, actor, slug, "viewer")`, before the stream starts, so errors can still return JSON.
  - It returns a `ReadableStream` that writes the header, then pages through `listActivity` with `limit: 500` and `before`, until a page comes back short.
  - `system` is the system slug, resolved from one preloaded id → slug map.
  - Export the route handler through a `handleActivityCsv(request, deps)` function taking `{ db, actor }`, so the test can call it without Next.
  - `export const dynamic = "force-dynamic"`.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(activity): export filtered activity as CSV`.

---

## Self-review notes

- **Coverage:** every item in scope has a task.
  - Progress chart: 8.1–8.3 and 8.5.
  - Time in column: 8.4 and 8.5.
  - Releases: 8.6–8.9, including the per-release estimate rollup in 8.7.
  - Decision map: 8.10–8.11.
  - Phase graph: 8.12.
  - Folding: 8.14.
  - Filters: 8.13.
  - CSV: 8.15.
- **Assumed names:** the ones from Parts 2, 3 and 4 are listed at the top and marked where they're used.
- **Tool budget:** 3 new read tools (`get_progress`, `list_releases`, `get_release`) and 2 new fields on existing tools, all with one-sentence descriptions.
