# Part 0: Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every defect the 2026-09-30 review found (server, API adapters, web UI) before any v2 feature work starts.

**Architecture:** No new subsystems. Each fix stays in the layer where the defect lives: ops (`src/lib/ops/*`), adapters (`src/lib/tools/*`, `src/app/api/*`, `src/server/trpc/*`), the browser query client (`src/trpc/*`) or components. Pure helpers are pulled out wherever a UI fix would otherwise be untestable, so the fix gets a vitest test.

**Tech Stack:** unchanged (Next.js 16, React 19, TanStack Query 5, tRPC 11, Drizzle 0.45 on Postgres 17 / PGlite in tests, Better Auth 1.7, vitest 5).

**Spec:** `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` (v2 index; there is no v2 spec). For behaviour this part does not change, see `docs/superpowers/specs/2026-09-29-roadmap-app-design.md`.

## Global Constraints

All Global Constraints of the v2 index apply, in particular commits (`type(scope): lowercase description` plus the `Co-Authored-By` trailer), the ops layer rule and the test rules. Part-specific:

- **No behaviour changes beyond the finding being fixed.** Existing tests must keep passing unchanged, except where a task explicitly changes the asserted behaviour. Such tests are named in the task.
- **One migration in this part:** Task 7, `npm run db:generate -- --name review-indexes`.
- **Advisory lock keys** are constants in `src/db/locks.ts`: `MIGRATION_LOCK = 727_001` and `FIRST_ADMIN_LOCK = 727_002`. No other file uses literal lock numbers.
- **Run a single test file** with `npx vitest run <path>` and a single test with `npx vitest run <path> -t "<name>"`.
- **UI tasks without a DOM test harness** (vitest runs in `node`, with no testing-library) get either a `renderToStaticMarkup` test, as `src/components/markdown.test.tsx` does, or a pure-helper test, plus a manual check in `npm run dev` against the demo seed (`npm run db:seed`). The manual steps are written out in the task.

## Review Focus

1. **Deleting a project while other tabs of the same user are open on it:** those tabs must not spin in retry loops. Tabs using the same query client get `NOT_FOUND` once and stop, and the deleting tab navigates at once. Pinned in Task 1 (`shouldRetryQuery` stops on any 4xx, and the `leavesProject` meta removes the project's queries).
2. **Reordering after concurrent creates that tied `sortOrder`** (two rows with the same value): a reorder must still write the exact requested order. Pinned in Task 5 (a test inserts two domains with equal `sortOrder` directly, then reorders).
3. **A sign-in `next` path that points off-site** (`//evil.test`, `/\evil.test`, `https://evil.test`, `/api/auth/...`): it must fall back to `/`. Pinned in Task 16 (`safeNextPath` table test).
4. **REST query strings with a typo, a repeated key, or a numeric-looking string for a string field:** a typo is a 400 that names the allowed parameters; a string field keeps the string. Pinned in Task 11.
5. **The first sign-in on a database that already holds a user row from a refused sign-in** (a `user` row without `discord_id` or allowlist entry): the first *provisioned* account still becomes admin. Pinned in Task 12.

---

### Task 1: Query retry policy and leaving a project cleanly

Fixes: "Deleting or leaving a project freezes for about 7 seconds".

**Files:**
- Modify: `src/trpc/query-client.ts` (add `retry` to `defaultOptions.queries`, export helpers)
- Modify: `src/trpc/client.tsx:15-22` (extend `mutationMeta`), `src/trpc/client.tsx:30-40` (`makeBrowserQueryClient`)
- Modify: `src/components/project-settings.tsx:116` (DangerZone mutation), `src/components/member-manager.tsx:161-172` (remove mutation)
- Test: `src/trpc/query-client.test.ts` (new)

**Interfaces:**
- Produces, in `src/trpc/query-client.ts`:
  - `shouldRetryQuery(failureCount: number, error: unknown): boolean`. It is false when `(error as { data?: { httpStatus?: number } })?.data?.httpStatus` is a number from 400 to 499, and otherwise true while `failureCount < 3`.
  - `queryProject(queryKey: readonly unknown[]): string | undefined`. tRPC query keys look like `[["projects","get"], { input: { project: "demo" }, type: "query" }]`. The function returns `input.project` when it is a string, and otherwise `undefined`.
- Produces, in `src/trpc/client.tsx`: the `mutationMeta` field `leavesProject?: string`. It holds the slug of a project the user no longer has access to after the mutation succeeds.

- [ ] **Step 1: Write the failing tests** in `src/trpc/query-client.test.ts`:
  - `shouldRetryQuery(0, { data: { httpStatus: 404 } })` → `false`; same for 400, 401, 403, 409, 429.
  - `shouldRetryQuery(0, { data: { httpStatus: 500 } })` → `true`; `shouldRetryQuery(3, { data: { httpStatus: 500 } })` → `false`.
  - `shouldRetryQuery(0, new Error("network"))` → `true`.
  - `queryProject([["projects", "get"], { input: { project: "demo" }, type: "query" }])` → `"demo"`.
  - `queryProject([["projects", "list"], { type: "query" }])` → `undefined`.
  - `queryProject([["systems", "get"], { input: { project: "demo", system: "login" }, type: "query" }])` → `"demo"`.
- [ ] **Step 2: Run** `npx vitest run src/trpc/query-client.test.ts`. Expected: FAIL, the exports do not exist.
- [ ] **Step 3: Implement.**
  - In `makeQueryClient`, set `queries: { staleTime: 30_000, retry: shouldRetryQuery }`.
  - In `makeBrowserQueryClient`, replace the `MutationCache.onSuccess` with a function of `(_data, _variables, _context, mutation)`. When `mutation.meta?.leavesProject` is set, first call `client.removeQueries({ predicate: (q) => queryProject(q.queryKey) === slug })`, then `client.invalidateQueries({ predicate: (q) => queryProject(q.queryKey) !== slug })`, and return that promise. Otherwise keep `client.invalidateQueries()` (Task 2 narrows it further).
  - In `DangerZone`, create the mutation as `useMutation({ ...trpc.projects.delete.mutationOptions(), meta: { leavesProject: slug } })`.
  - In `member-manager.tsx`, the remove mutation needs the meta only when the user removes themself. Keep the hook-level `onSuccess`. Build the mutation with `meta: { leavesProject: projectSlug }` only on a second mutation `leave`, used when `userId === currentUserId`. Route the self-removal button to `leave.mutate(...)` and every other removal to `remove.mutate(...)`. Use the component's existing slug prop; read its name in the file.
  - Update the doc comment of `makeBrowserQueryClient` to describe both paths.
- [ ] **Step 4: Run** `npx vitest run src/trpc/query-client.test.ts`. Expected: PASS. Then run `npm run typecheck`.
- [ ] **Step 5: Manual check:** `npm run dev`, sign in, create a throwaway project, and delete it from Settings. The page must reach `/` in under a second, and the Network tab must show no retried `projects.get` requests.
- [ ] **Step 6: Commit:** `fix(web): stop retrying 4xx queries and drop a left project's queries`

### Task 2: Scope invalidation after mutations and batch planning gaps

Fixes: "Every mutation refetches every query" and the per-system queries in `planning.gaps`.

**Files:**
- Create: `src/trpc/invalidation.ts`
- Modify: `src/trpc/client.tsx` (`makeBrowserQueryClient` uses it)
- Modify: `src/lib/ops/planning.ts:107-121` (add a batched variant next to `planningGaps`)
- Modify: `src/server/trpc/routers/planning.ts:14-18`
- Test: `src/trpc/invalidation.test.ts` (new), `src/lib/ops/planning.test.ts` (add cases)

**Interfaces:**
- Produces, in `src/trpc/invalidation.ts`:
  - `INVALIDATES: Record<string, readonly string[]>` maps a mutation router name to the query router names it can affect. Values:
    - `tasks` → `["systems", "planning", "history", "projects"]`
    - `systems` → `["systems", "planning", "history", "projects", "boards", "questions", "adrs"]`
    - `planning` → `["planning", "systems", "history", "projects"]`
    - `adrs` → `["adrs", "systems", "history", "projects"]`
    - `questions` → `["questions", "systems", "history", "projects"]`
    - `boards` → `["boards", "systems", "projects", "history"]`
    - `structure` → `["structure", "systems", "projects", "history"]`
    - `members` → `["members", "projects", "account"]`
    - `projects` → `["projects", "boards", "systems", "structure", "members", "history"]`
    - `account` → `["account", "members"]`
    - `history` → `["history"]`

    Before finalising, read `src/server/trpc/router.ts` for the exact router names and add any router that is missing. A router that isn't in the map invalidates everything.
  - `affectedRouters(mutationKey: readonly unknown[] | undefined): readonly string[] | "all"` reads the router name from a tRPC mutation key (`[["tasks","update"]]`). It returns `INVALIDATES[router]`, or `"all"` when the key or router is unknown.
  - `queryRouter(queryKey: readonly unknown[]): string | undefined` returns the first path segment of a tRPC query key.
- Produces, in `src/lib/ops/planning.ts`: `planningGapsFor(db: Executor, systemIds: string[]): Promise<Map<string, string[]>>`. It returns the same strings as `planningGaps` for each id, using one query for rounds and items (`inArray(planningRound.systemId, ids)`) and one for spec existence. It returns an empty map for an empty list. `planningGaps(db, id)` becomes `(await planningGapsFor(db, [id])).get(id) ?? []`.

- [ ] **Step 1: Write failing tests.**
  - In `invalidation.test.ts`:
    - `affectedRouters([["tasks","update"]])` → contains `"systems"` and not `"members"`.
    - `affectedRouters(undefined)` → `"all"`.
    - `affectedRouters([["unknown","x"]])` → `"all"`.
    - `queryRouter([["planning","gaps"], { input: { project: "p" }, type: "query" }])` → `"planning"`.
  - In `planning.test.ts`, add "planningGapsFor matches planningGaps for several systems": create 3 systems. Give one a spec and answered items in all four areas, give one a single open item, and give the third nothing. Expect `planningGapsFor(db, [a, b, c])` to deep-equal a map built from `planningGaps` of each. Also expect `planningGapsFor(db, [])` to have `size` 0.
- [ ] **Step 2: Run** `npx vitest run src/trpc/invalidation.test.ts src/lib/ops/planning.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `makeBrowserQueryClient`'s `onSuccess`, compute `affectedRouters(mutation.options.mutationKey)`. For `"all"`, invalidate everything. Otherwise call `invalidateQueries({ predicate: (q) => routers.includes(queryRouter(q.queryKey) ?? "") })`.
  - Combine this with the Task 1 `leavesProject` branch: first remove the project's queries, then do the scoped invalidation, skipping queries of that project.
  - Rewrite `planning.gaps` to `listSystems(...)`, filter the planning category, then call `planningGapsFor(ctx.db, ids)` and return `Object.fromEntries(map)`.
- [ ] **Step 4: Run** the same tests. Expected: PASS. Then run `npm test` (every existing planning test must still pass).
- [ ] **Step 5: Manual check:** in `npm run dev` on the seeded demo project, tick a task on a system page. In the Network tab, the batched refetch must include `systems.*` and `history.*` and must not include `members.list` or `account.users`.
- [ ] **Step 6: Commit:** `perf(web): invalidate only affected routers and batch planning gaps`

### Task 3: Dialog fixes (first project opens, board slug and cancel)

Fixes: "Creating your first project doesn't open it" and "The new board dialog overwrites a hand-edited slug and has no Cancel button".

**Files:**
- Modify: `src/components/new-project-dialog.tsx:32` and `:59-70`
- Modify: `src/components/new-board-dialog.tsx:28-85`

**Interfaces:** none new.

- [ ] **Step 1: Project dialog.** Move the success follow-up from `create.mutate(..., { onSuccess })` into `trpc.projects.create.mutationOptions({ onSuccess: ({ slug }, { name }) => { setOpen(false); toast.success(\`Project ${name.trim()} created\`); router.push(\`/p/${slug}\`); } })`. Add a comment in the style of `new-board-dialog.tsx:33-34` explaining that the empty state unmounts the dialog before the mutation settles. The submit handler then calls `create.mutate({...})` without options. Import `toast` from `sonner`.
- [ ] **Step 2: Board dialog.**
  - Add `const [slugTouched, setSlugTouched] = useState(false)`, as in `new-project-dialog.tsx:35`.
  - The name `onChange` sets the slug only while `!slugTouched`. The slug `onChange` sets `slugTouched(true)`. The success handler resets `slugTouched` to false.
  - In `DialogFooter`, before the submit button, add `<Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>`.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 4: Manual check.**
  - Against an empty database (`docker compose down -v` is not needed: sign in as a fresh admin on a new Postgres volume, or delete all projects), create a project from the empty state. The browser must land on `/p/<slug>` and show the toast.
  - In a project, open "New board", type a name, edit the slug by hand, and change the name again. The slug must stay as edited.
  - Cancel must close the dialog.
- [ ] **Step 5: Commit:** `fix(web): open a first project after creating it and keep hand-edited board slugs`

### Task 4: Error, not-found and loading screens

Fixes: "No error, not-found or loading screens anywhere", plus the stale comment in `src/trpc/server.tsx:28`.

**Files:**
- Create: `src/app/not-found.tsx`: the root 404 for unmatched URLs. A standalone page with the logo text "Roadmap", the heading "Page not found", one line "The address doesn't match any page.", and a `Button asChild` link "Go to your projects" to `/`.
- Create: `src/app/(app)/p/[project]/not-found.tsx`: rendered inside the project shell. Heading "Not found", text "This system, board or decision doesn't exist in this project, or it was renamed or deleted.", and a link "Back to the overview". The link goes to the project overview; read the slug with `useParams()` in a small client child, because `not-found.tsx` gets no params.
- Create: `src/app/(app)/error.tsx` and `src/app/(app)/p/[project]/error.tsx`. Both are `"use client"` and take `{ error, reset }: { error: Error & { digest?: string }; reset: () => void }`. They show the heading "Something went wrong", one line with `error.digest` as "Reference: <digest>" when present, a "Try again" button calling `reset()`, and a link home.
- Create: `src/app/global-error.tsx`: `"use client"`, renders its own `<html><body>` with the same content, for errors in the root layout.
- Create: `src/app/(app)/p/[project]/loading.tsx` and `src/app/(app)/(global)/loading.tsx`: skeletons built from the `Page` and `PageHeader` layout widths in `src/components/page.tsx`. They show a title bar block and three panel blocks with `animate-pulse bg-muted`, plus `aria-busy="true"` and `role="status"` with an sr-only "Loading…". Add `motion-reduce:animate-none`.
- Create: `src/components/status-screens.tsx`: shared presentational components `NotFoundScreen({ title, text, action })` and `ErrorScreen({ digest, onRetry, homeHref })` used by the files above.
- Modify: `src/trpc/server.tsx:26-29`: the comment now says other errors reach the nearest `error.tsx`.
- Test: `src/components/status-screens.test.tsx` (new)

**Interfaces:** `NotFoundScreen(props: { title: string; text: string; action: React.ReactNode })`, `ErrorScreen(props: { digest?: string; onRetry: () => void; homeHref: string })`.

- [ ] **Step 1: Write the failing test** with `renderToStaticMarkup`:
  - `NotFoundScreen` with title "Not found" renders an `<h1>` containing "Not found" and the action.
  - `ErrorScreen` with `digest: "abc"` renders "Reference: abc" and a button "Try again".
  - Without a digest it renders no "Reference".
- [ ] **Step 2: Run** `npx vitest run src/components/status-screens.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component file, then the route files using it. Use `Button`, and the page layout from `@/components/page`.
- [ ] **Step 4: Run** the test. Expected: PASS. Then run `npm run build`. The build output must list no new errors, and the not-found and error files must compile as client or server components as declared.
- [ ] **Step 5: Manual check.**
  - `/nope` shows the root 404.
  - `/p/demo/systems/nope` shows the in-shell 404 with the sidebar.
  - `/p/nope` shows the `(app)` not-found screen.
  - With the dev server running, throw temporarily in a view: the error screen with "Try again" appears. Remove the throw afterwards.
  - Clicking between sidebar sections shows the loading skeleton on a throttled network ("Slow 4G").
- [ ] **Step 6: Commit:** `feat(web): add not-found, error and loading screens`

### Task 5: Ordering: reorder bug, sort order under a parent lock, stable ties

Fixes: "Reordering domains or phases can save the wrong order" and "Sort order is picked as `max+1` with no lock".

**Files:**
- Modify: `src/lib/ops/structure.ts:196-215` (`reorderDomains`), `:313-330` (`reorderPhases`), `:38-50` (`createDomain`), `:~95-105` (`createPhase`), and the two list queries (`listDomains`, `listPhases`, which order by `sortOrder` only)
- Modify: `src/lib/ops/tasks.ts:44-62` (`addTask`), `src/lib/ops/systems.ts:163-195` (`createSystem`), `src/lib/ops/boards.ts:78-93` (`createBoard`)
- Test: `src/lib/ops/structure.test.ts`, `src/lib/ops/tasks.test.ts`

**Interfaces:** Produces `lockProject(tx: Executor, projectId: string): Promise<void>` in `src/lib/ops/lookup.ts`. It runs `select id from project where id = $1 for no key update`, the same lock `createAdr` takes at `src/lib/ops/adrs.ts:127`. Refactor `createAdr` to call it.

- [ ] **Step 1: Write failing tests** in `structure.test.ts`:
  - "reorders correctly after a delete left gaps": create domains A to E, delete A and B, reorder to `[E, D, C]`, and expect `listDomains` names `["E", "D", "C"]`.
  - The same test for phases.
  - "reorders correctly when sort orders tie": create X and Y, then set both `sortOrder` to 0 directly with `db.update(domain)`. Reorder to `[Y, X]` and expect `["Y", "X"]`. Reorder to `[X, Y]` and expect `["X", "Y"]`.
  - In `tasks.test.ts`: "appends after the last task even after deletes": add 3 tasks, delete the middle one, add a 4th, and expect the order `[1, 3, 4]` by title.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/structure.test.ts src/lib/ops/tasks.test.ts`. Expected: the gap and tie tests FAIL.
- [ ] **Step 3: Implement.**
  - In both reorder loops, skip a row only when `current[before].sortOrder === index`. For the logged "position" old value, keep `before + 1`.
  - Order `listDomains`, `listPhases` and the `.for("update")` selects in the reorder ops by `asc(sortOrder), asc(id)`, so ties are stable.
  - Call `lockProject(tx, project.id)` before the `max(sortOrder)` read in `createDomain`, `createPhase`, `createBoard` and `createSystem`.
  - In `addTask`, lock the system row before the `max`: replace `systemAccess(...)` with `projectAccess` followed by `findSystem(tx, project.id, systemSlug, true)`.
- [ ] **Step 4: Run** the tests. Expected: PASS. Then run `npm test`.
- [ ] **Step 5: Commit:** `fix(ops): reorder by stored position and allocate sort orders under a parent lock`

### Task 6: Lock order between task writes and plan writes

Fixes: "Deadlock between updating a task and writing a plan" (likely).

**Files:**
- Modify: `src/lib/ops/tasks.ts:25-40` (`taskAccess`)
- Test: `src/lib/ops/tasks.test.ts`

**Interfaces:** `taskAccess` keeps its signature and return shape `{ task, system }`.

- [ ] **Step 1: Write a test** that pins the behaviour kept across the refactor: "taskAccess still reports unknown and invisible tasks as not found". `updateTask(db, stranger, id, { title: "x" })` rejects with status 404 and message `Unknown task <id>.`, and `updateTask(db, owner, 999999, …)` gives the same. PGlite has one connection, so the deadlock itself can't be reproduced here. The Review Focus notes this.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/tasks.test.ts`. Expected: PASS (these cases already pass), so the refactor can be checked against them.
- [ ] **Step 3: Implement.**
  - First read `select system_id from task where id = $1` without a lock, and throw the same `NotFoundError` when it's missing.
  - Then lock the system with `select * from system where id = $systemId for no key update`.
  - Then lock the task with `select * from task where id = $1 for no key update`. If the task has disappeared or moved to another system in between, throw the same `NotFoundError`.
  - Then check access as today.
  - Add a comment: "Lock the system before the task, the order writePlan uses, so the two cannot deadlock."
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(ops): lock a task's system before the task to match plan writes`

### Task 7: Indexes on busy foreign keys

Fixes: "No secondary indexes on the busy foreign keys".

**Files:**
- Modify: `src/db/schema/content.ts`, `src/db/schema/planning.ts`, `src/db/schema/projects.ts`, `src/db/schema/auth.ts`. Add drizzle `index()` entries in each table's extra-config array, creating the array where a table has none.
- Create (generated): `drizzle/0002_review-indexes.sql`, via `npm run db:generate -- --name review-indexes`
- Test: `src/db/schema.test.ts`

**Indexes (name → table(columns)):**

| Name | Table and columns |
| --- | --- |
| `change_log_project_id_idx` | `change_log(project_id, id)` |
| `change_log_system_id_idx` | `change_log(system_id)` |
| `question_project_id_idx` | `question(project_id, resolved)` |
| `question_system_id_idx` | `question(system_id)` |
| `progress_update_system_id_idx` | `progress_update(system_id, created_at)` |
| `board_column_board_id_idx` | `board_column(board_id)` |
| `system_board_id_idx` | `system(board_id)` |
| `system_column_id_idx` | `system(column_id)` |
| `system_owner_user_id_idx` | `system(owner_user_id)` |
| `task_system_id_idx` | `task(system_id, sort_order)` |
| `task_owner_user_id_idx` | `task(owner_user_id)` |
| `adr_system_system_id_idx` | `adr_system(system_id)` |
| `planning_round_system_id_idx` | covered by `planning_round_number`; no index |
| `planning_item_round_id_idx` | `planning_item(round_id)` |
| `project_member_user_id_idx` | `project_member(user_id)` |
| `domain_project_id_idx` | `domain(project_id, sort_order)` |
| `phase_project_id_idx` | `phase(project_id, sort_order)` |
| `phase_dependency_depends_on_id_idx` | `phase_dependency(depends_on_id)` |
| `session_user_id_idx` | `session(user_id)` |
| `account_user_id_idx` | `account(user_id)` |
| `apikey_reference_id_idx` | `apikey(reference_id)` |
| `apikey_key_idx` | `apikey(key)` |

- [ ] **Step 1: Write the failing test** in `src/db/schema.test.ts`: "creates the lookup indexes". On `createTestDb()`, run `select indexname from pg_indexes where schemaname = 'public'` and expect it to contain every name in the table except the "covered" row.
- [ ] **Step 2: Run** `npx vitest run src/db/schema.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the `index("…").on(t.col, …)` entries (import `index` from `drizzle-orm/pg-core`), then run `npm run db:generate -- --name review-indexes`. Check that the generated SQL contains only `CREATE INDEX` statements.
- [ ] **Step 4: Run** the test. Expected: PASS. Then run `npm test`.
- [ ] **Step 5: Commit:** `perf(db): index foreign keys used by listings, lookups and cascades`

### Task 8: Input validation: empty ids and bounded integers

Fixes: "Empty-string ids crash with a 500", "Invalid integer input causes 500s over tRPC", and "`get_document.version` uses `z.coerce.number()`".

**Files:**
- Create: `src/lib/ops/params.ts`
- Modify: `src/lib/ops/systems.ts:31-59` (`createSystemInput`, `updateSystemInput`), `src/lib/ops/tasks.ts:18-23` (`updateTaskInput`), `src/lib/ops/structure.ts:32,135` (`dependsOn` items), `src/lib/ops/structure.ts:139` (`reorderInput`, already `min(1)`, keep)
- Modify: `src/server/trpc/routers/tasks.ts:8`, `src/server/trpc/routers/adrs.ts:8`, `src/server/trpc/routers/history.ts:24`
- Modify: `src/lib/tools/definitions.ts:78-82` (move `positiveInt` / `intParam` to use `params.ts`), `:352` (`get_document.version`)
- Test: `src/lib/ops/params.test.ts` (new), `src/lib/ops/systems.test.ts`, `src/server/trpc/router.test.ts`, `src/lib/tools/rest.test.ts`

**Interfaces:** Produces in `src/lib/ops/params.ts`:
- `MAX_INT = 2147483647`
- `entityId = z.string().trim().min(1)`, for a referenced row id
- `nullableEntityId = entityId.nullable()`
- `dbInt = z.number().int().min(1).max(MAX_INT)`

`definitions.ts` keeps `fromNumericString`, `positiveInt(max)` and `intParam(what)`, and `intParam` uses `MAX_INT`.

- [ ] **Step 1: Write failing tests.**
  - In `params.test.ts`: `entityId.safeParse("")` → not success; `dbInt.safeParse(3e9)` → not success; `dbInt.safeParse(7)` → success.
  - In `systems.test.ts`: `createSystem(db, owner, slug, { slug: "s", title: "S", domainId: "" })` and `updateSystem(..., { ownerUserId: "" })` both reject with `status: 400`.
  - In `router.test.ts`: `caller(db, owner).tasks.update({ id: 3e9, patch: { title: "x" } })` rejects with `code: "BAD_REQUEST"`.
  - In `rest.test.ts`: `GET /projects/<slug>/systems/s/documents/spec?version=abc` → 400; `?version=1` on a system with a v1 spec → 200.
- [ ] **Step 2: Run** these files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use `nullableEntityId` for `domainId`, `phaseId` and `ownerUserId` in both system inputs and in `updateTaskInput.ownerUserId`, keeping `.default(null)` / `.optional()` as they are.
  - Use `entityId` for the items of `dependsOn`.
  - Use `dbInt` in the three tRPC routers.
  - Replace `z.coerce.number().int().min(1).optional()` in `get_document` with `positiveInt(MAX_INT).optional()`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(ops): reject empty ids and out-of-range integers as invalid input`

### Task 9: Removed accounts never count as members or owners

Fixes: "A project can be left with no owner who can sign in" and "removed users still count in listings".

**Files:**
- Modify: `src/lib/ops/members.ts:37-43` (`keepAnOwner`), `:46-54` (`listMembers`)
- Modify: `src/lib/ops/summaries.ts:87-91` (the `memberCount` query in `projectNav`), and every other member count in `summaries.ts`; grep `projectMember` in that file
- Test: `src/lib/ops/members.test.ts`, `src/lib/ops/summaries.test.ts`

**Interfaces:** `keepAnOwner` and `listMembers` keep their signatures. `MemberItem` is unchanged; removed accounts are left out, not flagged.

- [ ] **Step 1: Write failing tests** in `members.test.ts`:
  - "an owner whose account was removed does not count as an owner": owner A creates the project and adds B as owner. An admin calls `removeAllowedAccount(db, admin, bDiscordId)`; look up B's discord id from the `user` row. Then `setMember(db, A, slug, { userId: A.userId, role: "viewer" })` rejects with status 409 "A project needs at least one owner.".
  - "listMembers leaves out removed accounts": after the removal, `listMembers` has only A.
  - In `summaries.test.ts`: `projectNav(...).memberCount` is 1 after the removal.
- [ ] **Step 2: Run** these files. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `.innerJoin(user, eq(user.id, projectMember.userId)).innerJoin(allowedAccount, eq(allowedAccount.discordId, user.discordId))` to the three queries, as `isMember` does at `members.ts:26-31`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(ops): ignore removed accounts in owner checks, member lists and counts`

### Task 10: Redundant queries in overview, ADR listing and navigation order

Fixes: "Redundant queries" (`getSystemOverview`, `listAdrs({system})`, `projectNav` order).

**Files:**
- Modify: `src/lib/ops/overview.ts:26-49`
- Modify: `src/lib/ops/adrs.ts:141-150` (`listAdrs`), and `loadAdrs`, which gets an optional system filter
- Modify: `src/lib/ops/summaries.ts:77-82` (`projectNav` systems order)
- Modify: `src/lib/ops/planning.ts`, `questions.ts`, `updates.ts`: export internal variants that take an already-resolved `projectId` / `systemId`
- Test: `src/lib/ops/overview.test.ts`, `src/lib/ops/adrs.test.ts`, `src/lib/ops/summaries.test.ts`

**Interfaces:** Produces the internal (no access check) readers:
- `planningOf(db: Executor, system: SystemRow): Promise<PlanningView>`, the body of `getPlanning` after its access check
- `questionsOf(db: Executor, projectId: string, filter: { systemId?: string; resolved?: boolean }): Promise<QuestionItem[]>`
- `adrsOf(db: Executor, projectId: string, filter: { status?: AdrStatus; systemId?: string }): Promise<AdrSummary[]>`
- `updatesOf(db: Executor, systemId: string | null, projectId: string, limit: number): Promise<UpdateItem[]>`

Use the existing return type names in those files; read them before naming. The public ops call these after their access check.

- [ ] **Step 1: Write the failing test** in `summaries.test.ts`: "projectNav lists systems in board order". Create a second board, then a system on board 2 before a system on board 1. Update board sort orders so board 1 comes first. Expect `projectNav(...).systems` to list the board-1 system first. The existing overview and ADR tests are the regression guard for the rest of the task.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/summaries.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `projectNav` orders by `asc(board.sortOrder), asc(system.sortOrder)`.
  - `listAdrs` with a `system` filter resolves the system id once and filters in SQL through an `innerJoin(adrSystem, …)` in `loadAdrs`.
  - `getSystemOverview` calls `getSystem` once, then the internal readers with `detail.system` and its project id, so there is no repeated `projectAccess`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `perf(ops): resolve access once per system overview and filter ADRs in SQL`

### Task 11: Tool adapters: missing documents, strict REST params, JSON errors, attribution note

Fixes: "`get_document` says `{"ok": true}` when there is no document", "REST silently drops unknown query params", "Errors from the bearer check itself escape the JSON handler", and "REST and MCP attribute writes differently (undocumented)".

**Files:**
- Modify: `src/lib/tools/rest.ts:29-35` (`coerceQuery`), `:67-72` (the bearer try/catch), `:80` (`result ?? { ok: true }`)
- Modify: `src/lib/mcp/server.ts:20-26` (`toResult`)
- Modify: `src/app/api/mcp/route.ts:19-25`
- Modify: `src/lib/tools/definitions.ts`, the `get_document` tool's `run`
- Modify: `README.md`, the "Agents: MCP and REST" section: one sentence that MCP writes default to the agent name "Claude Code" and REST writes carry no agent unless the body sets `agent`
- Test: `src/lib/tools/rest.test.ts`, `src/app/api/mcp/route.test.ts`, `src/lib/mcp/server.test.ts`

**Interfaces:** `coerceQuery(shape, params)` now throws `InvalidError` for a key not in `shape`, with the message `Unknown query parameter "<key>". Allowed: <keys joined by ", ">.`. A repeated key keeps the last value.

- [ ] **Step 1: Write failing tests.**
  - `rest.test.ts`: `GET /projects/<slug>/questions?resolve=true` → 400, and `json.error` contains `Unknown query parameter "resolve"` and `resolved`.
  - `GET /projects/<slug>/systems/s/documents/spec` on a system without a spec → 200 with `{ document: null }`.
  - A `resolveActor` that throws `new Error("db down")` → 500 with JSON `{ error: "Something went wrong." }`. Use `messageOf` for the text; read `src/lib/ops/errors.ts:71` for the exact message.
  - `route.test.ts`: `verifyApiKey` mocked to throw → POST returns status 500 and JSON with an `error` field.
  - `server.test.ts`: calling `get_document` through the MCP server for a spec-less system returns text that parses to `{ document: null }`.
- [ ] **Step 2: Run** these files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `get_document`'s `run` returns `(await getDocument(...)) ?? { document: null }`.
  - Both adapters substitute `{ ok: true }` only when the result is `undefined`.
  - Move the `resolveActor` call inside a `try` in `handleRest`. Rate limits still answer 429. Any other error goes through `statusOf` / `messageOf` into the JSON error response and is logged on 500.
  - Do the same in the MCP route with `Response.json({ error: messageOf(error) }, { status: statusOf(error) })`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(api): report missing documents, unknown query params and auth failures as JSON`

### Task 12: Advisory locks for migrations and the first admin

Fixes: "First sign-in race" and "Migrations race across replicas".

**Files:**
- Create: `src/db/locks.ts`
- Modify: `src/db/migrate.ts:11-18`
- Modify: `src/lib/ops/users.ts:50-68` (`linkDiscordAccount`)
- Test: `src/lib/ops/users.test.ts`

**Interfaces:** `MIGRATION_LOCK = 727_001`, `FIRST_ADMIN_LOCK = 727_002` (numbers, used as `bigint` SQL params).

- [ ] **Step 1: Write failing tests** in `users.test.ts`:
  - "the first provisioned account becomes admin even if a refused sign-in left a user row": insert a bare `user` row with no `discordId` and no allowlist entry. Then insert a second user U with no discord id, call `linkDiscordAccount(db, U.id, "123")`, and expect U to be `isAdmin: true` with `123` in `allowed_account`.
  - "a second account does not become admin": after that, a third user linking "456" stays `isAdmin: false` and is not allowlisted.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/users.test.ts`. Expected: the first test FAILS.
- [ ] **Step 3: Implement.**
  - In `linkDiscordAccount`, right after starting the transaction, run ``await tx.execute(sql`select pg_advisory_xact_lock(${FIRST_ADMIN_LOCK})`)``.
  - Change the "others" count to users other than `userId` with `discordId IS NOT NULL`: `and(ne(user.id, userId), isNotNull(user.discordId))`.
  - In `runMigrations`, after creating the client, call ``await client`select pg_advisory_lock(${MIGRATION_LOCK})` ``, run `migrate`, and in `finally` call ``await client`select pg_advisory_unlock(${MIGRATION_LOCK})` `` before `client.end()`. The client has `max: 1`, so all calls share one session.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Manual check:** with `docker compose up -d postgres`, run `npx tsx -e "import('./src/db/migrate.ts').then(m => Promise.all([m.runMigrations(process.env.DATABASE_URL), m.runMigrations(process.env.DATABASE_URL)]))"` with `--env-file=.env`. Both must resolve without "already exists".
- [ ] **Step 6: Commit:** `fix(db): serialise migrations and first-admin selection with advisory locks`

### Task 13: Question and planning consistency

Fixes: "`answerQuestion` doesn't lock the row", the `resolvedAt` drift, the missing `resolved` log entry, and "`reopenPlanning` has no state check".

**Files:**
- Modify: `src/lib/ops/questions.ts:55-63` (`findQuestion`, add a `lock` parameter), `:84-104` (`answerQuestion`), `:107-116` (`setQuestionResolved` uses the lock)
- Modify: `src/lib/ops/planning.ts:238-265` (`reopenPlanning`)
- Test: `src/lib/ops/questions.test.ts`, `src/lib/ops/planning.test.ts`

**Interfaces:** `findQuestion(tx, projectId, id, lock = false)`, where `lock` adds `.for("no key update")`.

- [ ] **Step 1: Write failing tests.**
  - "re-answering a resolved question keeps its resolvedAt": answer with `resolved: true`, read `resolvedAt`, answer again with `resolved: true`, and expect the same `resolvedAt`.
  - "answering with resolved false re-opens and logs it": answer resolved, then answer with `resolved: false`. Expect `resolved` false, `resolvedAt` null, and a `change_log` row `{ entity: "question", field: "resolved", oldValue: "true", newValue: "false" }`.
  - `planning.test.ts`: "reopening planning that is not complete is a conflict": `reopenPlanning` on a fresh system rejects with status 409 and a message containing "is not complete", and writes no `change_log` row with `field: "reopened"`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `answerQuestion` locks the row. It sets `resolvedAt` to `current.resolvedAt ?? now` when resolving an already-resolved question, `now` when newly resolving, and `null` when `resolved` is false.
  - When `current.resolved !== input.resolved`, it also logs a `resolved` change (old and new as `"true"` / `"false"`), exactly like `setQuestionResolved`.
  - `reopenPlanning` throws `new ConflictError(\`Planning of system ${parent.slug} is not complete; there is nothing to reopen.\`)` when `parent.planningCompletedAt` is null, before any write.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(ops): lock answered questions, keep resolve times and refuse reopening open planning`

### Task 14: Board and ADR change logging, and unique column names

Fixes: "The activity log is inconsistent" and "Duplicate column names are allowed".

**Files:**
- Modify: `src/lib/ops/boards.ts:26-31` (`columnRuleViolation`), `:96-112` (`updateBoard`), `:118-185` (`setBoardColumns`)
- Modify: `src/lib/ops/adrs.ts:170-185` (`updateAdr`)
- Test: `src/lib/ops/boards.test.ts`, `src/lib/ops/adrs.test.ts`

**Interfaces:** `columnRuleViolation(columns: { name: string; category: ColumnCategory }[]): string | null`. The parameter type gains `name`; check the callers compile.

- [ ] **Step 1: Write failing tests.**
  - `boards.test.ts`: `setBoardColumns` with two columns named "Review" and "review" rejects with status 409 and the message `Column names must be unique on a board; "review" appears twice.`
  - Calling `setBoardColumns` with the board's current columns unchanged writes no new `change_log` row.
  - `updateBoard(..., { sortOrder: 3 })` writes a row `{ entity: "board", field: "position", oldValue: "1", newValue: "4" }` (positions are 1-based, as for domains).
  - `adrs.test.ts`: `updateAdr` with a `title` equal to the current title and a changed `decision` logs `newValue: "decision"`. With every field unchanged, it logs nothing.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The duplicate check uses a case-insensitive trimmed `Set`. The message names the lower-cased duplicate.
  - In `setBoardColumns`, return early (after validation, without writes) when the new list has the same ids, names, categories and order as the current one.
  - `updateBoard` logs `position` when `sortOrder` changes.
  - `updateAdr` compares each patch field (and the system slug set) with `current` and logs only the changed ones. When nothing changed it returns without an update.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `fix(ops): log only real board and ADR changes and require unique column names`

### Task 15: Auth surface: Better Auth key endpoints, user listing, sign-out cache, move errors

Fixes:
- "Better Auth's own `/api/auth/api-key/*` endpoints are open to any session"
- "`account.users` lists every provisioned user"
- "Sign-out keeps the query cache in memory"
- "The move error always shows the planning-gate toast"

**Files:**
- Modify: `src/lib/auth/server.ts:59-90` (`createAuth`)
- Modify: `src/server/trpc/routers/account.ts:14` (`users`)
- Modify: `src/lib/ops/users.ts` (`listUsers` gains an access check)
- Modify: `src/app/(app)/p/[project]/settings/members/page.tsx:9`, `members-view.tsx:18` (pass the project)
- Modify: `src/components/shell/user-area.tsx:~60-72` (sign-out)
- Modify: `src/components/system/controls.tsx:90-99`
- Create: `src/components/system/move-error.ts`
- Test: `src/server/trpc/router.test.ts`, `src/lib/auth/server.test.ts` (new), `src/components/system/move-error.test.ts` (new)

**Interfaces:**
- `listUsers(db: Executor, actor: Actor, projectSlug: string): Promise<UserItem[]>` (keep the existing item type name). It calls `projectAccess(db, actor, projectSlug, "owner")` first.
- tRPC `account.users` input `z.object({ project: slugSchema })`.
- `BLOCKED_AUTH_PATH = /^\/api-key\//`, exported from `server.ts` together with `isBlockedAuthRequest(path: string, hasRequest: boolean): boolean`.
- `moveErrorKind(error: unknown): "planning-gate" | "other"`. It returns `"planning-gate"` only when `(error as { data?: { code?: string } }).data?.code === "CONFLICT"` and the message contains "still in planning".

- [ ] **Step 1: Write failing tests.**
  - `router.test.ts`: an editor calling `account.users({ project: slug })` rejects with `FORBIDDEN`; the owner gets the list.
  - `server.test.ts`: `isBlockedAuthRequest("/api-key/create", true)` → true; `("/api-key/create", false)` → false (a server-side call); `("/sign-in/social", true)` → false.
  - `move-error.test.ts`: `{ data: { code: "CONFLICT" }, message: "System x is still in planning…" }` → `"planning-gate"`; `{ data: { code: "FORBIDDEN" }, message: "…" }` → `"other"`; `new Error("fetch failed")` → `"other"`.
- [ ] **Step 2: Run** these files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `createAuth`, add `hooks: { before: createAuthMiddleware(async (ctx) => { if (isBlockedAuthRequest(ctx.path, !!ctx.request)) throw new APIError("NOT_FOUND"); }) }`. Import `createAuthMiddleware` from `better-auth/api`. Direct `getAuth().api.*` calls carry no `request`, so `createApiKey` in `account.ts` and `verifyApiKey` in `actor.ts` keep working.
  - Verify with the manual check in Step 5. If `ctx.request` turns out to be set for server calls in this Better Auth version, switch to Better Auth's `disabledPaths: ["/api-key/create", "/api-key/update", "/api-key/delete", "/api-key/list", "/api-key/get"]` and confirm server calls still work.
  - `user-area.tsx`: after `await authClient.signOut()`, call `queryClient.clear()`, using `useQueryClient()`, before navigating.
  - `controls.tsx`: `onError` uses `moveErrorKind(error) === "planning-gate" ? planningGateToast(data.gaps) : toast.error(error.message)`.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Manual check:** with `npm run dev` signed in, `fetch("/api/auth/api-key/create", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })` in the browser console returns 404. Creating a key on Settings → API keys still works, and the new key authenticates `GET /api/v1/projects`.
- [ ] **Step 6: Commit:** `fix(auth): close Better Auth key endpoints, limit user listing to owners and clear cache on sign-out`

### Task 16: Sign-in returns to the page you came from

Fixes: "Sign-in forgets the link you came from".

**Files:**
- Create: `src/lib/auth/next-path.ts`
- Modify: `src/proxy.ts:10-17`
- Modify: `src/app/login/page.tsx:70-75` (read `next`, pass it on), `src/app/login/sign-in-button.tsx:13-27` (a `next` prop used as `callbackURL`)
- Test: `src/lib/auth/next-path.test.ts` (new), `src/proxy.test.ts` (new)

**Interfaces:** `safeNextPath(value: string | string[] | undefined | null): string` returns a same-origin relative path or `"/"`.

- [ ] **Step 1: Write failing tests.**
  - `next-path.test.ts` table:
    - `"/p/demo/systems/login?tab=spec"` → itself
    - `undefined` → `"/"`
    - `""` → `"/"`
    - `"//evil.test"` → `"/"`
    - `"/\\evil.test"` → `"/"`
    - `"https://evil.test"` → `"/"`
    - `"/login"` → `"/"`
    - `"/login?next=/x"` → `"/"`
    - `"/api/auth/sign-out"` → `"/"`
    - `["/a", "/b"]` → `"/b"`
    - a 2100-character path → `"/"` (limit 2048)
  - `proxy.test.ts`: `proxy(new NextRequest("http://test/p/demo/adrs/3?x=1"))` without a cookie redirects to `http://test/login?next=%2Fp%2Fdemo%2Fadrs%2F3%3Fx%3D1`. A request for `/` redirects to `/login` with no `next`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `safeNextPath` rejects anything that doesn't start with exactly one `/`, contains a backslash, starts with `/login` or `/api/`, or is longer than 2048 characters.
  - The proxy sets `url.search = ""` and then, when the path isn't `/`, `url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search)`.
  - The login page passes `safeNextPath(params.next)` to `<SignInButton next={…} />`. The button uses `callbackURL: next` and keeps `errorCallbackURL: "/login"`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Manual check:** in a private window, open `http://localhost:3000/p/demo/systems/<a seeded slug>`. After Discord sign-in you must land on that system.
- [ ] **Step 6: Commit:** `feat(auth): return to the requested page after sign-in`

### Task 17: UI state fixes: search box, task input focus, drafts across refetch

Fixes: "The systems search box drifts from the URL", "Task input loses focus after each Enter" and "Unsaved column edits get thrown away" (plus `SystemNotes`).

**Files:**
- Modify: `src/components/systems/systems-toolbar.tsx:59-76`
- Modify: `src/components/task-list.tsx:260-282`
- Modify: `src/app/(app)/p/[project]/settings/boards/boards-view.tsx:100-106`, `src/components/column-editor.tsx:66-75`
- Modify: `src/app/(app)/p/[project]/systems/[system]/system-view.tsx:193`, `src/components/system-editor.tsx:20-…` (`SystemNotes`)
- Create: `src/components/column-draft.ts`
- Test: `src/components/column-draft.test.ts` (new)

**Interfaces:** `mergeColumnCounts(draft: DraftColumn[], server: { id: string; systemCount: number }[]): DraftColumn[]` returns the draft with each kept column's `systemCount` refreshed from the server list and every other field untouched. Move the `DraftColumn` type into `column-draft.ts` and import it in `column-editor.tsx`.

- [ ] **Step 1: Write the failing test:** a draft `[{ key: "a", id: "a", name: "Todo (renamed)", category: "todo", systemCount: 0 }, { key: "n1", name: "New", category: "review", systemCount: 0 }]` merged with `[{ id: "a", systemCount: 3 }]` gives the renamed name kept, `systemCount` 3 on "a", and the new column unchanged.
- [ ] **Step 2: Run** `npx vitest run src/components/column-draft.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Search:** add `useEffect(() => setQuery(current.q ?? ""), [current.q])` so URL changes (Clear filters, back and forward) reset the input.
  - **Task input:** remove `disabled={pending}` and use `readOnly={pending}`. The submit handler returns early when `pending`. Add `const inputRef = useRef<HTMLInputElement>(null)` and call `inputRef.current?.focus()` in the add `onSuccess` after `setTitle("")`.
  - **Column editor:** drop `systemCount` from the `ColumnEditor` key in `boards-view.tsx`, keeping slug, id, name and category. In `ColumnEditor`, add `useEffect(() => setDraft((d) => mergeColumnCounts(d, columns)), [columns])`.
  - **Notes:** the `SystemNotes` key becomes `systemSlug`. Inside `SystemNotes`, keep a `dirty` flag and copy the incoming `notes` into the textarea state only while not dirty (`useEffect` on `notes`). When `notes` changes while dirty, show a small line "Notes changed elsewhere since you started editing." above the Save button.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Manual check.**
  - Search "log" on Systems, then click Clear filters: the input empties.
  - Add three tasks with Enter only: focus stays in the field.
  - Rename a column in Settings → Boards and, without saving, move a system on that board in another tab: the draft survives and the count updates.
- [ ] **Step 6: Commit:** `fix(web): keep search, task input and unsaved drafts in sync across refetches`

### Task 18: UI copy and layout fixes

Fixes:
- "On phones the bottom action bar covers the last rows"
- "Times are UTC with no label"
- "Wrong plurals"
- "ADR wording differs", the ADR breadcrumb and ADR search
- "Question links on a system page"

**Files:**
- Create: `src/lib/text.ts`
- Modify: `src/app/(app)/p/[project]/systems/[system]/system-view.tsx:245` (spacer)
- Modify: `src/components/activity/timeline.tsx:~105-120` (day headings) and `:179-181` (time)
- Modify: `src/components/shell/app-sidebar.tsx:95`
- Modify: `src/app/(app)/p/[project]/adrs/adrs-view.tsx:47`, `src/app/(app)/p/[project]/adrs/[number]/adr-view.tsx:45`, `src/app/(app)/p/[project]/adrs/adr-list.tsx:27`
- Modify: `src/components/system/rail.tsx:67,90` (`DecisionsPanel` gets `systemSlug`), `system-view.tsx:192`
- Test: `src/lib/text.test.ts` (new), `src/app/(app)/p/[project]/adrs/adr-list.test.ts` (new, for the matcher)

**Interfaces:**
- `plural(n: number, one: string, many = \`${one}s\`): string` returns `"1 member"` or `"3 members"`.
- `adrMatches(row: { title: string; label: string; number: number }, query: string): boolean`, exported from `adr-list.tsx`. It is true when the trimmed lower-cased query is in the title, equals or is contained in the label (`"0003"`), equals the number (`"3"`), or matches `^adr-?0*(\d+)$` with the same number.

- [ ] **Step 1: Write failing tests.**
  - `plural(1, "member")` → `"1 member"`; `plural(2, "project")` → `"2 projects"`; `plural(0, "system")` → `"0 systems"`.
  - `adrMatches({ title: "Use SSE", label: "0003", number: 3 }, …)` → true for `"sse"`, `"0003"`, `"3"`, `"ADR-3"`, `"adr0003"`; false for `"4"` and `"adr-4"`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The spacer becomes `className="h-[calc(5rem+env(safe-area-inset-bottom))] lg:hidden"`.
  - The timeline shows times as `09:05 UTC`: append a `<span className="text-muted-foreground/70"> UTC</span>` after `formatTime`. The day heading's `title` reads "Days in UTC". Grouping stays UTC, which is the documented choice. Part 9 revisits local time with the locale.
  - The sidebar uses `plural(project.memberCount, "member")` and `plural(projects.length, "project")`.
  - The ADR list says `Superseded by ADR-${formatAdrNumber(n)}`, matching the detail page.
  - The ADR detail breadcrumbs become `[{ label: detail.project.name, href: \`/p/${slug}\` }, { label: "Decisions", href: \`/p/${slug}/adrs\` }, { label }]`. Read `detail` the way `adrs-view.tsx:57` does, adding the project query if the view doesn't already have it.
  - `AdrList` filters with `adrMatches`.
  - `DecisionsPanel` takes `systemSlug` and links each question to `/p/${projectSlug}/questions?system=${systemSlug}`. `system-view.tsx` passes it.
- [ ] **Step 4: Run** the tests, `npm run typecheck` and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Manual check.** At 390 px width with editor rights, the last activity row on a system page is fully visible above the bottom bar. A project with one member reads "1 member".
- [ ] **Step 6: Commit:** `fix(web): correct plurals, ADR wording and search, question links and mobile spacing`

### Task 19: Remove dead code and stale comments

Fixes: "Dead code" and the stale "server actions" comment.

**Files:**
- Delete: `src/components/history-list.tsx`, `src/components/update-list.tsx`
- Delete: `src/lib/progress.ts` and `src/lib/progress.test.ts`. `categoryProgress` is their only export and nothing else imports them; confirm with `grep -rn "@/lib/progress" src` returning nothing.
- Modify: `src/components/chips.tsx:~75-100`: remove `OwnerBadge` and `TaskStateBadge`, and their now-unused imports.
- Modify: `src/components/activity/timeline.tsx:108`: `groupByDay` loses `export`. It is used in the same file.
- Modify: `src/server/trpc/init.ts:66-69`: `publicProcedure` loses `export`. It is used by `protectedProcedure`. Update its doc comment.
- Modify: `src/server/trpc/init.ts:~44-50`: the `opErrors` doc comment says "the same text the ops report to MCP and REST" instead of mentioning server actions.
- Keep `TOOL_NAMES`: `src/lib/mcp/server.test.ts:6` uses it.

- [ ] **Step 1:** Confirm each target has no importer: `grep -rn "history-list\|update-list\|OwnerBadge\|TaskStateBadge\|@/lib/progress" src` prints only the files being deleted.
- [ ] **Step 2:** Make the deletions and edits.
- [ ] **Step 3: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 4: Commit:** `chore: remove unused components, helpers and a stale comment`

---

## Not in this part

"Three different filter-chip components and board filters not kept in the URL" is part of the Part 3 feature "Board filters in the URL", which builds one shared chip component. Part 0 leaves it alone so the work isn't done twice.
