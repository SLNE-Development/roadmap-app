# roadmap-app v2 Part 4: Planning and documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make planning and documents easier to judge and harder to get wrong: a coverage map of the planning interview, reopening a single planning area, heading outlines with section links, plan steps showing live task state, version diffs, column gates (entry rules per column), a project glossary, free project pages and full-text search inside documents.

**Architecture:** Everything is built on the ops layer, following the index rules. The pure pieces are separate, tested modules: coverage, heading slugs, diffs, the glossary text matcher and search query sanitising. Column gates are a rule registry in `src/lib/ops/gates.ts`, checked inside `moveSystem`'s transaction. Part 7 adds rules to it. Full-text search uses generated `tsvector` columns with GIN indexes and a single `searchProject` op, serving the command menu and a new `search` tool.

**Tech Stack:** as in the index. New dependencies: `diff` (8.x, ships its own types), `github-slugger` (2.x), `rehype-slug` (6.x), `unified` (11.x), `remark-parse` (11.x), `mdast-util-to-string` (4.x), `unist-util-visit` (5.x). The last four already come in through react-markdown; add them as direct dependencies with the versions `npm ls` shows, so imports are declared.

**Spec:** none (plans only). Read `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` first. Its Global Constraints and Shared names apply to every task here. Behaviour v2 doesn't change is in `docs/superpowers/specs/2026-09-29-roadmap-app-design.md` §5.4 (planning) and §8 (MCP).

## Global Constraints

- Everything in the index's Global Constraints applies: ops rule, adapters, commits (`type(scope): lowercase description` with the `Co-Authored-By` trailer), migrations, tests without Valkey, UI rules and permissions.
- **Assumed from Part 2:** `system.archivedAt` (timestamptz, nullable) and `project.archivedAt` exist. Search and gate card status leave out archived systems. If Part 2 named these differently, use its names.
- **Assumed from Part 0:** `move_system`'s error toast in `src/components/system/controls.tsx` branches on the tRPC `CONFLICT` code and shows the server's message. Gate errors rely on that. `get_document` returns `null` for a missing document, not `{ ok: true }`.
- **New change-log vocabulary introduced here** (add a sentence for each to `src/components/activity/change-sentence.ts` with a test):
  - `planning` / `area-reopened` (newValue: area; oldValue: reason)
  - `planning` / `area-completed` (newValue: area; oldValue: the user's confirmation)
  - `column` / `rules` (entityId: column id; newValue: rules summary such as `all-tasks-done, update-within-days(3)`)
  - `system` / `gateOverride` (newValue: `<column name>: <reason>`; oldValue: unmet rules joined with `; `)
  - `glossary` / `created` | `definition` | `deleted` (entityId: term id; newValue: term or definition)
  - `page` / `created` | `title` | `version` | `deleted` (entityId: page id; `version` newValue `v<n>`)
- **Agent token budget:** new tool descriptions are one or two sentences, and no response includes a document body the agent didn't ask for.
- Tools added here: `reopen_planning_area`, `complete_planning_area`, `get_glossary`, `set_glossary_term`, `list_pages`, `get_page`, `write_page`, `search`. Tools changed: `get_planning` (coverage fields), `get_document` (`since`), `move_system` (`overrideReason`), `list_boards` (column `rules`).

## Review Focus

1. **The same heading text twice, or headings with formatting, umlauts or emoji** ("Übersicht", "`code` step", "## Scope" twice): the outline links and the rendered heading ids are identical and unique, so every outline link scrolls to its heading. Pinned in Task 3.
2. **A search query that is tsquery syntax or punctuation** (`a & !b`, `foo:*`, `'`, `(`, `<->`, only spaces): no error and no 500. The query is sanitised into prefix words, and a query with no usable word returns `[]`. Pinned in Task 10.
3. **Someone edits a column's rules while another request moves a system into that column:** the two serialise on the board row lock, and the move sees either the old rules or the new ones, never half. Pinned in Task 6 (lock order and a test that a rule added before the move blocks it).
4. **Comparing two identical versions, or two 200 000-character versions:** identical versions show "No changes" with zero additions and zero removals; large versions diff in under 2 s in the test environment. Pinned in Task 5.
5. **A glossary term inside code, a link, a heading or another word** (`test` in `testing`, in `` `test` `` or inside `[test](…)`): not highlighted. Only whole-word matches in running text are, and only the first occurrence per document. Pinned in Task 8.

---

### Task 1: Planning coverage map

**Files:**
- Create: `src/lib/planning-coverage.ts`, `src/lib/planning-coverage.test.ts`
- Create: `src/components/planning/coverage-map.tsx`
- Modify: `src/lib/ops/planning.ts` (`PlanningView`, `getPlanning`)
- Modify: `src/app/(app)/p/[project]/systems/[system]/system-view.tsx` (planning tab)
- Modify: `src/lib/tools/definitions.ts` (`get_planning` description)
- Modify: `plugin/skills/plan-system/SKILL.md`
- Test: `src/lib/ops/planning.test.ts`

**Interfaces:**
- Consumes: `PLANNING_AREAS`, `PlanningArea`, `PlanningItemView`, `PlanningRoundView` from `src/db/schema/planning.ts` and `src/lib/ops/planning.ts`.
- Produces:
  - `interface AreaCoverage { area: PlanningArea; asked: number; answered: number; acceptedRisk: number; open: number; risks: number; thin: boolean; reason: string | null }`
  - `function planningCoverage(items: Pick<PlanningItemView, "area" | "status" | "isRisk">[]): AreaCoverage[]` returns one entry per `PLANNING_AREAS` element, in that order.
  - `const THIN_MIN_SETTLED = 2`
  - `PlanningView` gains `coverage: AreaCoverage[]` and `warnings: string[]`.

- [ ] **Step 1: Write the failing tests** in `src/lib/planning-coverage.test.ts`. An item is *settled* when its status is `answered` or `accepted-risk`. Cover:
  - `[]` gives four entries, each with `asked: 0` and `thin: true`, and `reason: "No questions asked yet."`.
  - Scope: two answered items and one open item give `asked 3, answered 2, open 1, thin false, reason null`.
  - Dependencies: one answered item gives `thin true`, `reason "Only 1 settled question; ask at least 2."`.
  - Failure-modes: three answered items, none with `isRisk`, give `thin true`, `reason "No failure mode is flagged as a risk."`. The same with one `isRisk` item gives `thin false`.
  - `acceptedRisk` counts `accepted-risk` items, and those count as settled.
  - Output order equals `PLANNING_AREAS`.
- [ ] **Step 2: Run** `npx vitest run src/lib/planning-coverage.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `planningCoverage`.**
  - The thin rules, in this order:
    1. `asked === 0` → "No questions asked yet."
    2. settled < `THIN_MIN_SETTLED` → the "Only N settled question(s)" message, singular for 1.
    3. area `failure-modes` with `risks === 0` → the risk message.
  - Otherwise `thin` is false and `reason` is `null`.
  - Doc comment: coverage is advisory; only `planningGaps` blocks completion.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Extend `getPlanning`.**
  - Compute `coverage = planningCoverage(rounds.flatMap(r => r.items))`.
  - `warnings` lists, for each thin area, `Area <area> is thin: <reason>`.
  - Once planning is complete, `warnings` is `[]` but `coverage` is still computed.
- [ ] **Step 6: Add a test to `src/lib/ops/planning.test.ts`.** A system with one round (scope answered ×2, dependencies answered ×1) returns `coverage[2].thin === false` for scope, dependencies thin, and `warnings` containing `"Area dependencies is thin: Only 1 settled question; ask at least 2."`. Run `npx vitest run src/lib/ops/planning.test.ts`. Expected: PASS.
- [ ] **Step 7: Build `CoverageMap`** (`src/components/planning/coverage-map.tsx`, props `{ coverage: AreaCoverage[] }`).
  - One row per area: the area name (reuse the area labels `PlanningRounds` already uses; export them from `src/components/planning-rounds.tsx` if they aren't exported), a segmented bar (answered: `bg-cat-done`, accepted-risk: `bg-cat-review`, open: `bg-cat-planning`, on `bg-track`), the counts "3 asked · 2 settled · 1 open", and a "Thin" chip with the reason as its text (`bg-cat-review-soft text-cat-review`) when `thin`.
  - Use `role="list"`, and give each bar an `aria-label` such as "scope: 2 of 3 settled".
- [ ] **Step 8: Show it on the planning tab.** In `system-view.tsx`'s planning tab, render `CoverageMap` above `PlanningRounds` whenever `planning.rounds.length > 0`. When `planning.gaps` is empty and planning is not complete, add the line "Ready to complete" followed by "Thin areas: …" if `planning.warnings` is non-empty.
- [ ] **Step 9: Update the agent-facing text.**
  - `get_planning`'s description becomes: "Get a system's planning interview: rounds, answers, gaps that block completion, and per-area coverage with thin-area warnings."
  - In `plugin/skills/plan-system/SKILL.md`, where the skill says to call `get_planning` and continue while `gaps` lists anything, add: "Also keep asking while `warnings` names a thin area, unless the user explicitly says that area needs no more questions; record that answer in the next round."
  - Run `npm run test:plugin` (the plugin tests check skill frontmatter).
- [ ] **Step 10: Run** `npm run lint && npm run typecheck && npm test`. Expected: all green.
- [ ] **Step 11: Commit.**
  ```bash
  git add src/lib/planning-coverage.ts src/lib/planning-coverage.test.ts src/components/planning/coverage-map.tsx src/components/planning-rounds.tsx src/lib/ops/planning.ts src/lib/ops/planning.test.ts "src/app/(app)/p/[project]/systems/[system]/system-view.tsx" src/lib/tools/definitions.ts plugin/skills/plan-system/SKILL.md
  git commit -m "feat(planning): show per-area coverage and thin-area warnings"
  ```

### Task 2: Reopen one planning area

**Semantics (decided here, documented in the op's doc comment):**
- Only a system whose planning is complete can have an area reopened. Otherwise `ConflictError("Planning of <slug> is not complete; keep answering in the open interview.")`.
- Reopening an area does **not** clear `planningCompletedAt` and does **not** move the system. Tasks may still be started and finished, because the rest of the plan stands.
- While an area is reopened:
  - `add_planning_round` is allowed, but only with items of reopened areas. An item of another area gives `InvalidError("Only reopened areas can get new questions: security is not reopened.")`. Here `security` stands for the first offending area name.
  - `answer_planning_items` is allowed for items of reopened areas only, with the same kind of error.
  - `move_system` into a column of category `done` is refused with `ConflictError("System <slug> has reopened planning areas: <areas>. Complete them with complete_planning_area first.")`. Moves into other columns are allowed.
- `complete_planning_area({ area, userConfirmation })` succeeds when the area has at least one item created after the reopen, and no item of that area is open. It sets `closedAt` and stores the confirmation. Otherwise `ConflictError` names what's missing: "No question was asked since area <area> was reopened." or "Item <id> is still open: …".
- A full `reopen_planning` closes every open area reopen (sets `closedAt` to now with confirmation `null`). The full interview is open again anyway.
- Reopening an already reopened area is a no-op that returns the existing reopen.

**Files:**
- Modify: `src/db/schema/planning.ts` (new table), then `npm run db:generate -- --name planning-area-reopen`
- Modify: `src/lib/ops/planning.ts`, `src/lib/ops/systems.ts` (`moveSystem`)
- Modify: `src/lib/tools/definitions.ts`, `src/server/trpc/routers/planning.ts`
- Create: `src/components/planning/reopen-area-dialog.tsx`
- Modify: `src/app/(app)/p/[project]/systems/[system]/system-view.tsx`, `src/components/activity/change-sentence.ts` (+ its test)
- Test: `src/lib/ops/planning.test.ts`, `src/lib/ops/systems.test.ts`

**Interfaces:**
- Produces:
  - Table `planning_area_reopen`: `id text pk`, `system_id text not null → system.id on delete cascade`, `area text enum PLANNING_AREAS not null`, `reason text not null`, `reopened_by_user_id text → user.id set null`, `agent text`, `reopened_at timestamptz not null default now()`, `closed_at timestamptz`, `confirmation text`. Add a partial unique index on `(system_id, area) where closed_at is null`, using drizzle `uniqueIndex(...).on(t.systemId, t.area).where(sql\`closed_at is null\`)`.
  - `export const reopenAreaInput = z.object({ area: z.enum(PLANNING_AREAS), reason: z.string().trim().min(3).max(1000) })`
  - `export const completeAreaInput = z.object({ area: z.enum(PLANNING_AREAS), userConfirmation: z.string().trim().min(1).max(2000) })`
  - `reopenPlanningArea(db, actor, projectSlug, systemSlug, raw): Promise<{ area: PlanningArea; reopenedAt: Date }>` (editor)
  - `completePlanningArea(db, actor, projectSlug, systemSlug, raw): Promise<{ area: PlanningArea; closedAt: Date }>` (editor)
  - `openAreaReopens(db: Executor, systemId: string): Promise<{ area: PlanningArea; reason: string; reopenedAt: Date }[]>` (exported for `moveSystem` and views)
  - `PlanningView` gains `reopenedAreas: { area: PlanningArea; reason: string; reopenedAt: Date }[]`.

- [ ] **Step 1: Write the failing op tests** in `src/lib/ops/planning.test.ts`. Build fixtures with `createProjectFixture`, a system, a completed planning (use `completePlanningFixture`) and one scope round answered. Cover:
  1. `reopenPlanningArea(scope, reason "new partner API")` keeps `planningCompletedAt` set and the column unchanged, and `getPlanning` shows `reopenedAreas[0].area === "scope"`. The change log has `planning/area-reopened` with newValue `scope`.
  2. `addPlanningRound` with a `dependencies` item while only scope is reopened throws `InvalidError` whose message contains "dependencies is not reopened". With a scope item it succeeds.
  3. `completePlanningArea(scope)` before any new item throws `ConflictError` containing "No question was asked since area scope was reopened". After adding and answering one item it succeeds, and `reopenedAreas` is `[]`.
  4. `reopenPlanningArea` on a system still in planning throws `ConflictError`.
  5. Calling `reopenPlanningArea` twice for scope returns the same `reopenedAt`, and only one row is open.
  6. `reopenPlanning` (full) after an area reopen leaves `reopenedAreas` as `[]`.
  7. A viewer calling `reopenPlanningArea` gets `ForbiddenError`.
- [ ] **Step 2: Write the failing move test** in `src/lib/ops/systems.test.ts`. With scope reopened, `moveSystem(... column: "Done")` throws `ConflictError` containing "reopened planning areas: scope". `moveSystem(... column: "Review")` succeeds.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/planning.test.ts src/lib/ops/systems.test.ts`. Expected: FAIL.
- [ ] **Step 4: Add the table** to `src/db/schema/planning.ts` with a doc comment ("Single planning areas reopened after planning was completed, and their closing confirmation"). Run `npm run db:generate -- --name planning-area-reopen` and inspect the SQL for the partial unique index.
- [ ] **Step 5: Implement the ops.**
  - Replace `assertOpen(parent)` in `addPlanningRound` and `answerPlanningItems` with `assertWritable(tx, parent, areas)`. It passes when planning is not complete. When planning is complete, it loads `openAreaReopens` and throws `InvalidError` for the first area not in that set, or the existing `ConflictError` when there are no open reopens at all.
  - `answerPlanningItems` must resolve the areas of the answered items first; the join already exists, so select `planningItem.area` too.
  - `completePlanningArea` locks the system (`lockForPlanning`).
    - "Items since reopen" means items whose round's `created_at` is ≥ the reopen's `reopened_at`.
    - Log `planning/area-completed` with `newValue` = the area and `oldValue` = the confirmation.
  - `reopenPlanning` updates open reopens of the system to `closed_at = now()`.
- [ ] **Step 6: Add the done-column check to `moveSystem`,** after the planning gate and before rule gates (Task 6). When `column.category === "done"` and `openAreaReopens(tx, current.id)` is non-empty, throw the `ConflictError` from the Semantics section.
- [ ] **Step 7: Run the tests from Steps 1 and 2.** Expected: PASS.
- [ ] **Step 8: Add the tools.**
  - `reopen_planning_area` (POST `/projects/:project/systems/:system/planning/areas/reopen`, write), with description: "Reopen one planning area of a completed system, with the reason, without moving the system. Only that area then accepts new rounds and answers."
  - `complete_planning_area` (POST `…/planning/areas/complete`, write), with description: "Close a reopened planning area once its new questions are answered; userConfirmation quotes the user's words."
  - Update `reopen_planning`'s description to: "Reopen the whole planning interview and move the system back to the planning column; prefer reopen_planning_area for a single area."
  - Add tRPC procedures `planning.reopenArea` and `planning.completeArea` with inputs `{ ...S, ...reopenAreaInput.shape }` and `{ ...S, ...completeAreaInput.shape }`.
- [ ] **Step 9: Build the UI.**
  - `ReopenAreaDialog` (`src/components/planning/reopen-area-dialog.tsx`): a shadcn `Dialog` with an area `NativeSelect` (areas not currently reopened), a required reason `Textarea`, and a submit button "Reopen area". Put its success handling in `mutationOptions` (not on `mutate`), as in `NewSystemDialog`.
  - In `system-view.tsx` on the planning tab: when planning is complete and `canEdit`, put a "Reopen one area" button next to the existing `ReopenPlanningButton` that opens the dialog.
  - Show each open reopen as a `bg-cat-planning-soft` banner: "Area scope reopened 2 Oct: new partner API". Completing an area is done by the agent through the tool, so the web UI has no complete button. The banner says "An agent closes this area with complete_planning_area once its questions are answered."
- [ ] **Step 10: Add change sentences.** In `change-sentence.ts`, `planning:area-reopened` → "reopened the <area> area of" and `planning:area-completed` → "completed the <area> area of". Add both to `change-sentence.test.ts` with concrete entries.
- [ ] **Step 11: Run** `npm run lint && npm run typecheck && npm test`. Expected: all green.
- [ ] **Step 12: Commit** with message `feat(planning): reopen and complete a single planning area`.

### Task 3: Heading ids, document outline and section links

**Files:**
- Create: `src/lib/headings.ts`, `src/lib/headings.test.ts`
- Modify: `src/components/markdown.tsx`, `src/components/markdown.test.tsx`
- Create: `src/components/document-outline.tsx`
- Modify: `src/components/document-section.tsx` (and the `VersionedDocument` component that `system-view.tsx` renders; find it with `grep -rn "function VersionedDocument" src`)
- Modify: `package.json` (add `github-slugger`, `rehype-slug`, `unified`, `remark-parse`, `mdast-util-to-string`, `unist-util-visit`)

**Interfaces:**
- Produces:
  - `interface Heading { depth: 1 | 2 | 3; text: string; id: string }`
  - `function extractHeadings(markdown: string): Heading[]` parses with `unified().use(remarkParse).use(remarkGfm)`, visits `heading` nodes of depth ≤ 3 in document order, takes text with `mdast-util-to-string`, and assigns ids with one `new GithubSlugger()` per call. It must visit **all** headings (depth 1–6) through the slugger so duplicate counters match rehype-slug, but only return depth ≤ 3.
  - `Markdown` gains the prop `headingIds?: boolean`. When true it adds `rehypePlugins={[rehypeSlug]}`, and headings h1–h3 render a hover anchor link (`<a href="#id" aria-label="Link to section …">#</a>`) after their text.
  - `DocumentOutline({ headings }: { headings: Heading[] })`

- [ ] **Step 1: Write the failing tests** in `src/lib/headings.test.ts`, feeding `# Intro\n## Scope\n## Scope\n### Übersicht 🚀\n## \`code\` step\n#### deep\n\`\`\`\n# not a heading\n\`\`\``. Expected:
  - ids `intro`, `scope`, `scope-1`, `übersicht-`, `code-step`.
  - The depth-4 heading is not returned.
  - The fenced `# not a heading` is not returned.
  - Texts are `Scope`, `Übersicht 🚀`, `code step`.

  The expected ids here are what github-slugger produces. If a run shows a different form (for example for the emoji), set the expectation to github-slugger's actual output: the rule under test is equality with rehype-slug, not a particular spelling.
- [ ] **Step 2: Write the failing equality test** in `src/components/markdown.test.tsx`. Render the same markdown with `<Markdown headingIds>` via `renderToStaticMarkup`, and assert that every id from `extractHeadings` appears as `id="<id>"` in the HTML, in the same order. Also assert that without `headingIds` no `id=` attribute appears, so other markdown such as comments and updates stays unchanged.
- [ ] **Step 3: Run** `npx vitest run src/lib/headings.test.ts src/components/markdown.test.tsx`. Expected: FAIL.
- [ ] **Step 4: Install and implement.**
  - Install with `npm install github-slugger rehype-slug`, then add `unified remark-parse mdast-util-to-string unist-util-visit` at the versions `npm ls unified remark-parse mdast-util-to-string unist-util-visit` shows.
  - Implement `extractHeadings`.
  - In `Markdown`, map `h1`–`h3` through a component that renders the anchor link only when `headingIds` is set. Keep `skipHtml` and the existing link handling.
- [ ] **Step 5: Run the tests.** Expected: PASS. Also confirm the existing "drops raw HTML" test still passes.
- [ ] **Step 6: Build `DocumentOutline`.**
  - A `nav aria-label="Contents"` listing headings, with depth 3 indented, each item a link to `#id`.
  - At `lg` and up it is a sticky column (`sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto`). Below `lg` it is a collapsible "Contents" disclosure (shadcn `Collapsible`; add it with `npx shadcn@latest add collapsible` if missing) above the document.
  - The current heading is highlighted with an `IntersectionObserver` over the heading elements (`rootMargin: "0px 0px -70% 0px"`), shown with `aria-current="location"` and `text-foreground font-medium`.
  - When the document has fewer than 3 headings, render nothing.
- [ ] **Step 7: Use it on the spec and plan tabs.**
  - In `DocumentSection` (and `VersionedDocument`), compute `extractHeadings(doc.body)` once with `useMemo`. Render the body with `<Markdown headingIds>` in a grid `lg:grid-cols-[minmax(0,1fr)_220px] gap-8`, with the outline on the right.
  - Section links keep the query string, so `?tab=spec&spec=2#scope` works. After hydration, if `location.hash` is set, scroll the matching element into view once (`useEffect` on mount).
  - Nothing else in the app gets `headingIds`.
- [ ] **Step 8: Run** `npm run lint && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 9: Commit** with message `feat(docs): add heading outline and section links to specs and plans`.

### Task 4: Plan steps with live task state

**Files:**
- Create: `src/lib/plan-steps.ts`, `src/lib/plan-steps.test.ts`
- Create: `src/components/plan-steps-panel.tsx`
- Modify: `src/components/markdown.tsx` (optional `stepStates` prop), `src/components/document-section.tsx` / `VersionedDocument` (plan tab only), `system-view.tsx`

**Interfaces:**
- Consumes: `TaskItem` (it has `planStep: number | null`) from `src/lib/ops/systems.ts`, via the system overview the page already loads.
- Produces:
  - `function stepNumberOf(headingText: string): number | null` matches `/^(?:step|task)\s+(\d{1,3})\b/i` on the trimmed heading text and returns the number.
  - `function stepStates(tasks: Pick<TaskItem, "id" | "planStep" | "state" | "title">[]): Map<number, { taskId: number; state: TaskState; title: string }>`
  - `Markdown` prop `stepStates?: Map<number, { taskId: number; state: TaskState }>`: when given, a heading whose text yields a step number with an entry renders a small `TaskStateChip` after its text.
  - `PlanStepsPanel({ tasks, projectSlug, systemSlug })`

- [ ] **Step 1: Write the failing tests** in `src/lib/plan-steps.test.ts`:
  - `stepNumberOf("Step 3: Wire the API")` → 3.
  - `stepNumberOf("Task 12 - Tests")` → 12.
  - `stepNumberOf("Steps overview")` → null.
  - `stepNumberOf("Step three")` → null.
  - `stepStates` over tasks `[{id: 5, planStep: 2, state: "done"}, {id: 6, planStep: null, state: "todo"}]` → map with only key 2 → `{ taskId: 5, state: "done" }`.
- [ ] **Step 2: Run** `npx vitest run src/lib/plan-steps.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement both functions.** Run again. Expected: PASS.
- [ ] **Step 4: Write a failing markdown test.** `<Markdown stepStates={new Map([[1, { taskId: 9, state: "doing" }]])}>{"## Step 1: Build\n## Step 2: Ship"}</Markdown>` renders the chip for step 1 (assert the text `In progress`, or whatever label the existing task state chip uses for `doing`) and none for step 2.
- [ ] **Step 5: Implement the chip rendering** in the `h1`–`h3` components from Task 3, reusing the existing state chip from `src/components/chips.tsx` if one fits. Otherwise add a small `TaskStateChip` there using the category colours: todo → `cat-todo`, doing → `cat-active`, blocked → `cat-blocked`, done → `cat-done`. Run the test. Expected: PASS.
- [ ] **Step 6: Build `PlanStepsPanel`.**
  - A card titled "Steps" that lists tasks with a `planStep`, ordered by `planStep`: step number, title, state chip and owner avatar.
  - Each row links to the task row on the overview (`?tab=overview#task-<id>`). Add `id="task-<id>"` to task rows in `src/components/task-list.tsx` if they don't have one.
  - The header shows "4 of 7 done".
  - Tasks without a `planStep` are listed under "Not in the plan" with a muted note.
  - On the plan tab, render the panel above the document on small screens and as the first item of the right column (above the outline) at `lg`.
- [ ] **Step 7: Label older versions.** When an older plan version is shown, the panel shows "Task state is live; you are viewing plan v2", because tasks follow the latest plan.
- [ ] **Step 8: Run** `npm run lint && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 9: Commit** with message `feat(docs): show live task state on plan steps`.

### Task 5: Spec and plan diffs

**Files:**
- Create: `src/lib/diff.ts`, `src/lib/diff.test.ts`
- Modify: `src/lib/ops/documents.ts` (`compareDocuments`, `getDocument` `since`)
- Modify: `src/lib/tools/definitions.ts` (`get_document`), `src/server/trpc/routers/history.ts` (`compare` procedure)
- Create: `src/components/document-diff.tsx`, `src/components/compare-picker.tsx`
- Modify: `src/components/document-section.tsx`, `system-view.tsx` (the `compare` search param), `src/components/activity/timeline.tsx`, `src/components/system/activity-feed.tsx`
- Test: `src/lib/ops/documents.test.ts`

**Interfaces:**
- Produces:
  - `type DiffLine = { kind: "same" | "add" | "del"; oldNo: number | null; newNo: number | null; parts: { text: string; changed: boolean }[] }`
  - `type DiffHunk = { header: string; lines: DiffLine[] }`
  - `function diffDocuments(oldBody: string, newBody: string, context = 3): { hunks: DiffHunk[]; added: number; removed: number }`
    - Uses `diffLines`. For each run of removed lines followed by added lines, pairs them one to one and fills `parts` with `diffWordsWithSpace` (changed words `changed: true`). Unpaired lines are a single part with `changed: true`.
    - Keeps `context` unchanged lines around changes. `header` is the nearest preceding markdown heading text (for example `## Scope`), or `@@ -a,b +c,d @@` when there is none.
  - `function unifiedDiff(oldBody: string, newBody: string, oldLabel: string, newLabel: string): string` wraps `createTwoFilesPatch` with 3 context lines.
  - `compareDocuments(db: Executor, actor: Actor, projectSlug: string, systemSlug: string, kind: DocumentKind, from: number, to: number): Promise<{ kind; from: DocumentView; to: DocumentView; hunks: DiffHunk[]; added: number; removed: number }>` (viewer). It throws `NotFoundError` for an unknown version and `InvalidError("from must be lower than to.")` when `from >= to`.
  - `getDocument(..., version?, since?)`: with `since`, the result is `{ kind, version, versions, authorName, agent, createdAt, since, diff: string }`, with `body` left out. `since` must be lower than the resolved version; otherwise `InvalidError`.

- [ ] **Step 1: Write the failing tests** in `src/lib/diff.test.ts`:
  1. Identical bodies → `hunks: []`, `added: 0`, `removed: 0`.
  2. `"## Scope\n- rebuild nightly\n"` → `"## Scope\n- rebuild on every write\n"` gives one hunk with header `## Scope`, one `del` and one `add` line. The add line's changed parts join to `on every write`, and the del line's to `nightly`.
  3. An appended line gives `added: 1`, `removed: 0`, and its line numbers are set (`oldNo: null`, `newNo` = the new line number).
  4. `unifiedDiff("a\n", "b\n", "spec v1", "spec v2")` contains `--- spec v1`, `+++ spec v2`, `-a`, `+b`.
  5. Two 200 000-character bodies differing in 50 scattered lines diff in under 2000 ms (measure with `performance.now()`).
- [ ] **Step 2: Run** `npx vitest run src/lib/diff.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run `npm install diff`. The `diff` package ships its own types; verify, and add nothing if it does. Implement both functions. Run the tests. Expected: PASS.
- [ ] **Step 4: Write the failing op tests** in `src/lib/ops/documents.test.ts`:
  - Spec v1 "a", v2 "b": `compareDocuments(1, 2)` → `added 1, removed 1`.
  - `compareDocuments(2, 1)` → `InvalidError`.
  - `compareDocuments(1, 9)` → `NotFoundError`.
  - `getDocument(kind "spec", version undefined, since 1)` → has `diff` containing `-a` and `+b` and no `body` key.
  - A non-member → `NotFoundError`.
- [ ] **Step 5: Implement the ops.** Run the tests. Expected: PASS.
- [ ] **Step 6: Wire the adapters.**
  - `get_document` input gains `since: positiveInt(2147483647).optional().describe("Return only the changes since this version, as a unified diff, instead of the body.")`. Keep `version` on `positiveInt` (Part 0 already replaced `z.coerce.number()`; if not, replace it here).
  - Description: "Get a system's spec or plan (latest or a given version) with all version numbers; pass since to get only the diff from an older version."
  - Add the tRPC procedure `history.compare` with input `{ ...S, kind, from: z.number().int().min(1).max(2147483647), to: same }`.
- [ ] **Step 7: Build the UI.**
  - `CompareToggle`: a segmented "Read / Compare" control in the document header, shown when `versions.length > 1`.
  - "Compare" sets `?compare=<latest-1>..<latest>` on the current tab. `CompareSelects` shows two `NativeSelect`s (from, to) that update the param. An invalid param falls back to the last two versions.
  - `DocumentDiff({ hunks, added, removed })`:
    - Monospace, with line numbers in two gutters. `add` rows use `bg-cat-done-soft`, `del` rows `bg-danger-soft`, and changed word parts `<mark>` with a stronger tint.
    - Hunk headers sit in `bg-muted text-muted-foreground`.
    - A summary line reads "+6 −3".
    - With no hunks, show `EmptyState` "No changes between v1 and v2".
    - The whole diff scrolls horizontally inside its own container.
  - When `compare` is present on the spec or plan tab, `system-view.tsx` fetches with `trpc.history.compare` and renders `DocumentDiff` in place of the document.
- [ ] **Step 8: Link diffs from activity.**
  - In `timeline.tsx` and `system/activity-feed.tsx`, a `document` entry whose `newValue` matches `/^v(\d+)$/` with N > 1 gets a trailing link "Compare with v<N-1>". The link points to `/p/<project>/systems/<system>?tab=<field>&compare=<N-1>..<N>`. The system slug is already available where the entry links to its system.
  - Add a test to `change-sentence.test.ts` only if the sentence text changes; the link is rendered markup.
- [ ] **Step 9: Run** `npm run lint && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 10: Commit** with message `feat(docs): compare spec and plan versions`.

### Task 6: Column gates: rule registry and enforcement

**Files:**
- Modify: `src/db/schema/projects.ts` (new table), then `npm run db:generate -- --name column-rules`
- Create: `src/lib/ops/gates.ts`, `src/lib/ops/gates.test.ts`
- Modify: `src/lib/ops/systems.ts` (`moveSystemInput`, `moveSystem`), `src/lib/ops/boards.ts` (rules in listings, `setColumnRules`), `src/lib/ops/lookup.ts` (if `loadBoards` shapes columns)
- Modify: `src/lib/tools/definitions.ts` (`move_system`, `list_boards`, new `set_column_rules`), `src/server/trpc/routers/boards.ts`, `src/server/trpc/routers/systems.ts`
- Modify: `src/components/activity/change-sentence.ts` (+ test)
- Test: `src/lib/ops/systems.test.ts`, `src/lib/ops/boards.test.ts`

**Interfaces:**
- Produces:
  - Table `column_rule`: `id text pk`, `column_id text not null → board_column.id on delete cascade`, `rule text not null`, `param integer`, `sort_order integer not null`, `unique(column_id, rule)`.
  - In `src/lib/ops/gates.ts`:
    ```ts
    export interface GateSubject { id: string; slug: string; projectId: string }
    export interface GateRule {
      id: string;                                   // e.g. "all-tasks-done"
      label: (param: number | null) => string;      // "All tasks done", "Progress update in the last 3 days"
      param?: { min: number; max: number; default: number; unit: string };
      /** Returns, per subject id, why the rule is unmet, or null when met. One query for all subjects. */
      check: (tx: Executor, subjects: GateSubject[], param: number | null, now: Date) => Promise<Map<string, string | null>>;
    }
    export const GATE_RULES: Map<string, GateRule>;
    export function registerGateRule(rule: GateRule): void;  // throws Error on a duplicate id
    export interface ColumnRuleRow { rule: string; param: number | null }
    export interface GateResult { column: string; met: number; total: number; unmet: string[] }
    export function evaluateGates(tx: Executor, subjects: GateSubject[], columnName: string, rules: ColumnRuleRow[], now: Date): Promise<Map<string, GateResult>>;
    export function gateMessage(systemSlug: string, result: GateResult): string;
    ```
  - Built-in rules registered at module load:

    | id | met when | unmet message |
    | --- | --- | --- |
    | `all-tasks-done` | every task of the system is `done` (no tasks counts as met) | "2 open tasks (#188, #189)", listing at most 5 ids then "…" |
    | `no-open-questions` | no question with `system_id` = the system and `resolved = false` | "1 open question" / "3 open questions" |
    | `spec-exists` | a `system_document` of kind `spec` exists | "no spec" |
    | `plan-covers-tasks` | a plan exists and every task has a non-null `planStep` | "no plan" or "tasks #12, #15 are not in the plan" |
    | `update-within-days` (param 1–60, default 3, unit "days") | the latest `progress_update.created_at` ≥ now − param days | "no progress update in the last 3 days" |
    | `adr-linked` | at least one `accepted` ADR is linked to the system through `adr_system` | "no accepted ADR linked" |

  - `gateMessage` text: `Can't move <slug> to <column>. Missing: <unmet joined with "; ">. Finish them, or ask a project owner to move it with overrideReason.`
  - `moveSystemInput` gains `overrideReason: z.string().trim().min(3).max(500).optional()`.
  - `setColumnRulesInput = z.object({ column: z.string().min(1), rules: z.array(z.object({ rule: z.string(), param: z.number().int().nullable().optional() })).max(10) })`
  - `setColumnRules(db, actor, projectSlug, boardSlug, raw)` (owner).
  - `listBoards` columns gain `rules: ColumnRuleRow[]`.

- [ ] **Step 1: Write the failing tests** in `src/lib/ops/gates.test.ts`, one `describe` per rule, each with a met case and an unmet case built through the ops (tasks via `addTask`/`updateTask`, questions via `addQuestion`, specs via `writeSpec`, ADRs via `createAdr`/`acceptAdr`, updates via `postUpdate`). Also cover:
  - Evaluating three systems at once runs one query per rule, not per system. Spy on `tx.select` count, or simply assert the correct results for 3 subjects of mixed state.
  - `update-within-days` uses the passed `now`: `now` = latest update + 2 days, with param 3, is met; with param 1 it is unmet with the "1 day" wording (singular).
  - `registerGateRule` with an existing id throws.
  - `gateMessage` output for two unmet rules equals exactly: `Can't move search-index to Done. Missing: 2 open tasks (#1, #2); 1 open question. Finish them, or ask a project owner to move it with overrideReason.`
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/gates.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the table to `src/db/schema/projects.ts` with the doc comment "Entry rules of a board column, checked when a system moves into it". Run `npm run db:generate -- --name column-rules`. Implement `gates.ts`. Run the tests. Expected: PASS.
- [ ] **Step 4: Write the failing `setColumnRules` tests** in `src/lib/ops/boards.test.ts`:
  - An owner sets `[{rule: "all-tasks-done"}, {rule: "update-within-days", param: 3}]` on "Done", and `listBoards` returns them in that order.
  - An unknown rule id → `InvalidError` naming the known ids.
  - A param out of range → `InvalidError`.
  - A param on a rule without one → `InvalidError`.
  - Rules on the planning column → `InvalidError("The planning column cannot have entry rules; the planning interview is its gate.")`.
  - An editor → `ForbiddenError`.
  - The change log gets `column/rules` with newValue `all-tasks-done, update-within-days(3)`.
  - Deleting the column (via `setBoardColumns`) cascades its rules.
- [ ] **Step 5: Implement `setColumnRules`.**
  - Lock the board row `FOR UPDATE` first, then replace the column's rules (delete + insert with `sort_order` = index).
  - `moveSystem` already share-locks the target board, so rule edits and moves serialise. Say this in the doc comment.
  - Run the tests. Expected: PASS.
- [ ] **Step 6: Write the failing move tests** in `src/lib/ops/systems.test.ts`:
  1. Done has `all-tasks-done`, and the system has one todo task. `moveSystem` to Done throws `ConflictError` whose message equals `gateMessage` output.
  2. The same move with `overrideReason: "shipping behind a flag"` by the **owner** succeeds, and the log has `system/gateOverride` with newValue `Done: shipping behind a flag` and oldValue `1 open task (#<id>)`.
  3. An editor passing `overrideReason` → `ForbiddenError("Only project owners can override column rules.")`.
  4. `overrideReason` when every rule is met is accepted, and no override entry is logged.
  5. A move into a column without rules is unaffected.
  6. An admin who is not a member can override, consistent with admin access in `projectAccess`.
- [ ] **Step 7: Implement the check in `moveSystem`.**
  - Order: after the planning gate and after Task 2's done-column check, and only when `column.id !== current.columnId`.
  - Load the rules of `column.id`. Call `evaluateGates(tx, [current], column.name, rules, new Date())`.
  - If anything is unmet: without `overrideReason` throw `ConflictError(gateMessage(...))`. With it, require role `owner` (use the role `projectAccess` returns, or `actor.isAdmin`), then log the override.
  - Run the tests. Expected: PASS.
- [ ] **Step 8: Wire the adapters.**
  - `move_system` gains `overrideReason` (described as "Owner only: move despite unmet column rules; the reason is logged.").
  - `list_boards` returns columns with `rules`, each shaped `{ rule, param, label }` (add `label` via `GATE_RULES.get(rule)?.label(param)`).
  - New tool `set_column_rules`: PUT `/projects/:project/boards/:board/columns/rules`, write, with description "Set a column's entry rules (owner only); an empty list removes them."
  - tRPC: `boards.setColumnRules`, and `systems.move` accepts `overrideReason`.
- [ ] **Step 9: Add change sentences** for `column:rules` ("set entry rules of column <name>: …") and `system:gateOverride` ("moved <system> past unmet rules: <reason>"), each with a test.
- [ ] **Step 10: Run** `npm run lint && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 11: Commit** with message `feat(boards): enforce column entry rules on moves`.

### Task 7: Column gates UI: rules editor and card status

**Files:**
- Create: `src/components/settings/column-rules-dialog.tsx`
- Modify: `src/components/column-editor.tsx` (a "Rules" button per saved column), `src/app/(app)/p/[project]/settings/boards/boards-view.tsx`
- Create: `src/server/trpc/routers/gates.ts` (register in `src/server/trpc/router.ts`)
- Modify: `src/components/board-view.tsx`, `src/components/system-card.tsx`, `src/components/system/controls.tsx` (owner override prompt)
- Test: `src/server/trpc/router.test.ts` (or a new `gates` router test beside it)

**Interfaces:**
- Consumes: `GATE_RULES`, `evaluateGates`, `ColumnRuleRow`, `GateResult` from Task 6.
- Produces:
  - tRPC query `gates.board({ project, board })` → `Record<string /* systemId */, GateResult>`. For each non-archived system on the board, the "next gated column" is the first column **to the right** of the system's column, in board order, that has rules. Systems with no such column are absent.
  - tRPC query `gates.rules()` → `{ id: string; label: string; param?: { min; max; default; unit } }[]` for the editor.

- [ ] **Step 1: Write the failing router test.**
  - Board Development with columns Planning, Todo, Review (rules: `spec-exists`), Done (rules: `all-tasks-done`, `no-open-questions`).
  - System A is in Todo with a spec. System B is in Review with one open task.
  - `gates.board` → `A: { column: "Review", met: 1, total: 1, unmet: [] }` and `B: { column: "Done", met: 1, total: 2, unmet: ["1 open task (#<id>)"] }`.
  - A viewer can call it; a non-member gets NOT_FOUND.
- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement `gates.board`.** Group systems by their next gated column and call `evaluateGates` once per column, so the query count doesn't grow with the number of systems. Implement `gates.rules`. Run the test. Expected: PASS.
- [ ] **Step 4: Build `ColumnRulesDialog`.**
  - Props: `{ projectSlug, boardSlug, column: { id; name; category; rules: ColumnRuleRow[] }, canEdit }`.
  - One row per rule from `gates.rules()`: a `Checkbox` with the label, plus a number `Input` (min/max from `param`, suffix with the unit) when the rule has a param.
  - Save calls `boards.setColumnRules`. The success toast "Rules saved" lives in `mutationOptions`.
  - The planning column shows a disabled button with a tooltip: "The planning interview is this column's gate."
  - Viewers and editors see the rules read-only.
- [ ] **Step 5: Hook it into the column editor.** In `column-editor.tsx`, saved columns (those with an `id`) get a "Rules (2)" button that opens the dialog. Unsaved columns show "Save columns to add rules".
- [ ] **Step 6: Show gate status on cards.**
  - `board-view.tsx` queries `gates.board`. `system-card.tsx` gets an optional `gate?: GateResult` prop and renders "Review 2/3" in muted text.
  - When `met === total`, show a `cat-done` check with the text "Review ready". When unmet, a `Tooltip` lists `unmet`.
  - The status is also available as text for screen readers, for example "Review rules: 2 of 3 met".
- [ ] **Step 7: Handle a failed move by an owner.**
  - In `src/components/system/controls.tsx` (and the board's drop handler), when a move fails with CONFLICT whose message starts with "Can't move" and the viewer is an owner, show the message in an `AlertDialog`. It has a reason `Textarea` and a "Move anyway" action that retries with `overrideReason`.
  - Non-owners only see the error toast with the message. The optimistic card position is rolled back in both cases (the existing optimistic logic in `board-view.tsx`).
- [ ] **Step 8: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: green.
- [ ] **Step 9: Commit** with message `feat(boards): edit column rules and show gate status on cards`.

### Task 8: Glossary

**Files:**
- Modify: `src/db/schema/projects.ts` (new table), then `npm run db:generate -- --name glossary`
- Create: `src/lib/ops/glossary.ts`, `src/lib/ops/glossary.test.ts`
- Create: `src/lib/glossary-match.ts`, `src/lib/glossary-match.test.ts` (the rehype plugin)
- Modify: `src/components/markdown.tsx` (`glossary` prop), `src/components/markdown.test.tsx`
- Create: `src/server/trpc/routers/glossary.ts` (register it)
- Create: `src/app/(app)/p/[project]/settings/glossary/page.tsx`, `glossary-view.tsx`; modify `src/components/settings/settings-nav.tsx`
- Modify: `src/lib/tools/definitions.ts`, `src/components/activity/change-sentence.ts` (+ test)

**Interfaces:**
- Produces:
  - Table `glossary_term`: `id text pk`, `project_id → project.id cascade`, `term text not null`, `definition text not null`, `aliases text[] not null default '{}'`, `updated_by_user_id → user.id set null`, `agent text`, `updated_at timestamptz not null default now()`, and a unique index on `(project_id, lower(term))` (`uniqueIndex("glossary_term_project_term").on(t.projectId, sql\`lower(${t.term})\`)`).
  - `setGlossaryTermInput = z.object({ term: z.string().trim().min(1).max(60), definition: z.string().trim().min(1).max(1000), aliases: z.array(z.string().trim().min(1).max(60)).max(10).default([]) })`
  - `listGlossary(db, actor, projectSlug): Promise<GlossaryTerm[]>` (viewer, ordered by `lower(term)`)
  - `setGlossaryTerm(db, actor, projectSlug, raw): Promise<{ id: string; created: boolean }>` (editor; upserts by case-insensitive term)
  - `deleteGlossaryTerm(db, actor, projectSlug, term: string): Promise<void>` (editor; `NotFoundError` when unknown)
  - `glossaryBrief(db: Executor, projectId: string): Promise<{ term: string; definition: string }[]>` has **no access check**. It is for callers that already checked access (Part 5's project brief resource), and says so in its doc comment.
  - `interface GlossaryTerm { id: string; term: string; definition: string; aliases: string[] }`
  - `function rehypeGlossary(terms: GlossaryTerm[]): (tree) => void`
    - A rehype plugin. It wraps the **first** whole-word, case-insensitive occurrence of each term or alias in text nodes.
    - It skips text inside `code`, `pre`, `a` and `h1`–`h6`.
    - The wrapper is element `abbr` with `properties: { title: definition, dataGlossary: "" }`.
    - "Whole word" means Unicode boundaries: `(?<![\p{L}\p{N}_])term(?![\p{L}\p{N}_])` with flags `iu`, with the term regex-escaped. Longer terms match first.
  - `Markdown` prop `glossary?: GlossaryTerm[]`: when non-empty, adds the plugin, and `components.abbr` renders the shadcn `Tooltip` with the definition, keyboard-focusable (`tabIndex={0}`, dotted underline).

- [ ] **Step 1: Write the failing matcher tests** in `src/lib/glossary-match.test.ts`. Run `unified().use(remarkParse).use(remarkRehype).use(rehypeGlossary(terms)).use(rehypeStringify)`; add `remark-rehype` and `rehype-stringify` as devDependencies if they aren't already direct dependencies. Terms: `[{term: "Outbox", definition: "Queue table…", aliases: ["outbox table"]}, {term: "test", …}]`. Cover:
  - `"The outbox table feeds workers. The outbox again."` → one `<abbr` around `outbox table` (the longer alias wins), and the second "outbox" is not wrapped.
  - `"testing tests"` → no wrap.
  - `` "`test` and [test](https://x) and ## test" `` → no wrap inside code, link or heading.
  - `"A test."` → wrapped.
  - The German term `Übergabe` in `"die Übergabe."` → wrapped.
- [ ] **Step 2: Run the test.** Expected: FAIL. **Implement** the plugin with `unist-util-visit`, splitting text nodes. Run again. Expected: PASS.
- [ ] **Step 3: Write the failing op tests** in `src/lib/ops/glossary.test.ts`:
  - Create "Outbox", then set "outbox" again with a new definition → `created: false`, one row, the definition updated, and the change log has `glossary/definition`.
  - A viewer's `setGlossaryTerm` → `ForbiddenError`.
  - Deleting an unknown term → `NotFoundError`.
  - `listGlossary` is ordered case-insensitively.
  - `glossaryBrief` returns `[{term, definition}]`.
- [ ] **Step 4: Implement** the table, the migration and the ops. Run the tests. Expected: PASS.
- [ ] **Step 5: Wire the adapters.**
  - Tools: `get_glossary` (GET `/projects/:project/glossary`, read), with description "List the project's glossary terms and definitions; use these words in specs and plans."
  - `set_glossary_term` (PUT `/projects/:project/glossary`, write), input `{ ...P, ...setGlossaryTermInput.shape, delete: z.boolean().optional() }`, with description "Add or change a glossary term; delete: true removes it." With `delete: true`, call `deleteGlossaryTerm` and ignore `definition` (make `definition` optional in the tool's input only for that case, and validate in `run`: `definition` is required unless `delete`).
  - tRPC: `glossary.list`, `glossary.set` and `glossary.delete`.
- [ ] **Step 6: Build the UI.**
  - Settings page "Glossary" (in the settings nav after Structure): a table of term, aliases and definition. Editors get an inline add form and edit/delete per row, with the delete confirmation built into an `AlertDialog`.
  - Pass `glossary={terms}` to `Markdown` on the spec and plan tabs (Task 3 components) and on project pages (Task 9). The page prefetches `glossary.list` next to the document.
- [ ] **Step 7: Add change sentences** for `glossary:created|definition|deleted`, each with a test.
- [ ] **Step 8: Run** `npm run lint && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 9: Commit** with message `feat(docs): add a project glossary highlighted in documents`.

### Task 9: Project pages

**Files:**
- Modify: `src/db/schema/content.ts` (two tables), then `npm run db:generate -- --name project-pages`
- Create: `src/lib/ops/pages.ts`, `src/lib/ops/pages.test.ts`
- Create: `src/server/trpc/routers/pages.ts` (register it)
- Create: `src/app/(app)/p/[project]/pages/page.tsx`, `pages-view.tsx`, `src/app/(app)/p/[project]/pages/[page]/page.tsx`, `page-view.tsx`
- Create: `src/components/pages/page-editor.tsx`
- Modify: `src/components/shell/app-sidebar.tsx`, `src/components/shell/command-menu.tsx`, `src/lib/ops/summaries.ts` (`counts.pages`)
- Modify: `src/lib/tools/definitions.ts`, `src/components/activity/change-sentence.ts` (+ test)

**Interfaces:**
- Produces:
  - Table `project_page`: `id text pk`, `project_id → project.id cascade`, `slug text not null`, `title text not null`, `sort_order integer not null`, `created_at timestamptz default now()`, `unique(project_id, slug)`.
  - Table `page_version`: `id text pk`, `page_id → project_page.id cascade`, `version integer not null`, `body text not null`, `author_user_id → user.id set null`, `agent text`, `created_at timestamptz default now()`, `unique(page_id, version)`.
  - `writePageInput = z.object({ page: slugSchema, title: z.string().trim().min(1).max(120).optional(), body: z.string().trim().min(1).max(200_000) })`
  - `listPages(db, actor, projectSlug): Promise<{ slug; title; version; updatedAt: Date; authorName; agent }[]>` (viewer; `sort_order` then title)
  - `getPage(db, actor, projectSlug, pageSlug, version?, since?): Promise<PageView>`, where `PageView` has the same shape as `DocumentView` plus `slug` and `title`. `since` behaves exactly like Task 5's `getDocument` (the diff instead of the body). An unknown page → `NotFoundError`.
  - `writePage(db, actor, projectSlug, raw): Promise<{ version: number; created: boolean }>` (editor)
    - It creates the page when the slug is unknown; `title` is then required, otherwise `InvalidError("title is required for a new page.")`.
    - Otherwise it appends version N+1 under a `FOR UPDATE` lock on the `project_page` row, and updates `title` when it's given and different (logging `page/title`).
  - `deletePage(db, actor, projectSlug, pageSlug)` (owner)
  - `comparePages(db, actor, projectSlug, pageSlug, from, to)` reuses `diffDocuments` and returns the same shape as `compareDocuments`.

- [ ] **Step 1: Write the failing op tests:**
  - Writing a new page with a title → `{version: 1, created: true}`.
  - Writing again with no title → version 2, title unchanged.
  - Writing a new slug without a title → `InvalidError`.
  - Two concurrent writes (`Promise.all`) to the same page → versions 2 and 3, with no unique violation.
  - `getPage(version 1)` returns the v1 body; `getPage(since 1)` returns a `diff` and no `body`.
  - A viewer's write → `ForbiddenError`; an editor's delete → `ForbiddenError`; an owner's delete removes the versions too.
  - The change log has `page/created`, `page/version` (`v2`) and `page/deleted`.
- [ ] **Step 2: Run the tests.** Expected: FAIL. **Implement** the tables, the migration and the ops. Run again. Expected: PASS.
- [ ] **Step 3: Wire the adapters.**
  - Tools: `list_pages` (GET `/projects/:project/pages`), with description "List the project's pages (onboarding, conventions, architecture) with their latest version."
  - `get_page` (GET `/projects/:project/pages/:page`, `version?`, `since?`), with description "Get a project page, a given version, or only its diff since a version."
  - `write_page` (PUT `/projects/:project/pages/:page`, write), with description "Create a project page or write its next version (markdown); title is required for a new page."
  - tRPC: `pages.list`, `pages.get`, `pages.compare`, `pages.write` and `pages.delete`.
- [ ] **Step 4: Build the UI.**
  - `/p/[project]/pages` is a list: title, "v3 · Ammo · 2 Oct", and a "New page" button for editors that opens a dialog with title and slug, the slug auto-derived until edited. Use the same slug pattern as `NewSystemDialog`, whose slug-edited flag avoids the bug Part 0 fixes in `NewBoardDialog`. The empty state reads "No pages yet. Pages hold what isn't tied to one system: onboarding, conventions, architecture."
  - `/p/[project]/pages/[page]` renders with Task 3's outline, Task 5's `CompareToggle` and `DocumentDiff`, Task 8's glossary and a `VersionPicker`.
  - Editors get "Edit", which opens `PageEditor`: a `Textarea` with a "Preview" tab rendering `Markdown`, and "Save as v<N+1>".
  - If the latest version changed since the editor opened (compare `version` at open with a fresh `pages.get` on save, or catch it on the server by adding an optional `baseVersion` to `writePageInput` that raises `ConflictError("Page <slug> changed since you opened it (now v<N>). Copy your text, reload and apply it again.")`), show that message. Implement the server-side `baseVersion` check, and test it in Step 1's file as an extra case: `baseVersion` 1 while the latest is 2 → `ConflictError`.
- [ ] **Step 5: Add navigation.**
  - The sidebar gets "Pages" (lucide `BookOpen`) after Decisions, with `count: project.counts.pages`. Add `pages` to `ProjectNav.counts` in `summaries.ts` using a `count()` query.
  - The command menu gets a "Pages" section item, and one item per page when the current project's pages are passed in `CommandMenuData` (add `pages?: { slug: string; title: string }[]`).
- [ ] **Step 6: Add change sentences** for `page:created|title|version|deleted`, with tests.
- [ ] **Step 7: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: green.
- [ ] **Step 8: Commit** with message `feat(docs): add versioned project pages`.

### Task 10: Search inside documents

**Files:**
- Modify: `src/db/schema/content.ts` (tsvector columns and GIN indexes on `system`, `system_document`, `adr`, `question`, `page_version`), then `npm run db:generate -- --name search`
- Create: `src/db/schema/tsvector.ts` (drizzle `customType` for `tsvector`)
- Create: `src/lib/search-query.ts`, `src/lib/search-query.test.ts`
- Create: `src/lib/ops/search.ts`, `src/lib/ops/search.test.ts`
- Create: `src/server/trpc/routers/search.ts` (register it)
- Modify: `src/components/shell/command-menu.tsx`, `src/lib/tools/definitions.ts`

**Interfaces:**
- Produces:
  - `export const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" })`
  - Generated stored columns named `search`. Use `.generatedAlwaysAs(sql\`…\`)` in drizzle, and `index("<table>_search").using("gin", t.search)`:
    - `system`: `setweight(to_tsvector('english', coalesce(title,'')), 'A') || setweight(to_tsvector('english', coalesce(summary,'')), 'B') || setweight(to_tsvector('english', coalesce(notes,'')), 'C')`
    - `system_document`: `to_tsvector('english', body)`
    - `adr`: title A; context, decision, alternatives and consequences B
    - `question`: title A, text B, answer C
    - `page_version`: `to_tsvector('english', body)`. Page titles are matched through `project_page` with `to_tsvector('english', title)` computed in the query, since there are few pages.
  - `function toPrefixQuery(raw: string): string | null`
    - Splits on anything that isn't `\p{L}` or `\p{N}`, drops words shorter than 2 characters and keeps at most 8 words.
    - Returns them joined as `word:* & word2:*`, lowercased, or `null` when no word is left.
    - Never passes user text to `to_tsquery` unprocessed.
  - `searchProjectInput = z.object({ q: z.string().max(200), kinds: z.array(z.enum(["system", "spec", "plan", "adr", "question", "page"])).optional(), limit: z.number().int().min(1).max(50).default(20) })`
  - `interface SearchHit { kind: "system" | "spec" | "plan" | "adr" | "question" | "page"; title: string; href: string; snippet: string; rank: number }`
    - `snippet` comes from `ts_headline('english', <text>, q, 'StartSel=\u0002,StopSel=\u0003,MaxWords=18,MinWords=6,MaxFragments=1')`.
    - `href` examples: `/p/<slug>/systems/<system>`, `…?tab=spec`, `/p/<slug>/adrs/<number>`, `/p/<slug>/questions?system=<system>` or `/p/<slug>/questions`, `/p/<slug>/pages/<page>`.
  - `searchProject(db, actor, projectSlug, raw): Promise<SearchHit[]>` (viewer)
    - Only the **latest** version of each system document and page is searched: `distinct on (system_id, kind) … order by system_id, kind, version desc` in a subquery, then match.
    - Archived systems (Part 2 `system.archivedAt`) and their documents are left out.
    - Results are ordered by `ts_rank_cd` desc, then kind order system, spec, plan, adr, page, question.

- [ ] **Step 1: Check PGlite.** Write a throwaway vitest (delete it in Step 3) that runs `select to_tsvector('english', 'Rebuilding indexes') @@ to_tsquery('english', 'rebuild:*') as ok` and `ts_headline` on PGlite through `createTestDb()`. Run `npx vitest run <file>`.
  - Expected: `ok = true`.
  - If `'english'` is unavailable in PGlite, use `'simple'` everywhere in this task, both in the schema and the queries, and note that in the commit body. Don't make production and tests differ.
- [ ] **Step 2: Write the failing query-sanitiser tests** in `src/lib/search-query.test.ts`:
  - `toPrefixQuery("Rebuild index")` → `"rebuild:* & index:*"`
  - `"a & !b"` → `null` (single letters dropped)
  - `"foo:* <-> (bar)"` → `"foo:* & bar:*"`
  - `"'"` → `null`
  - `"   "` → `null`
  - `"Übergabe"` → `"übergabe:*"`
  - 20 words → 8 terms
- [ ] **Step 3: Implement `toPrefixQuery`.** Run the tests. Expected: PASS. Delete the throwaway file from Step 1.
- [ ] **Step 4: Add the columns** with the custom type and GIN indexes. Run `npm run db:generate -- --name search` and read the SQL. If drizzle-kit can't emit the generated columns or `USING gin` correctly, write that SQL in a custom migration (`npx drizzle-kit generate --custom --name search`) and leave the schema columns declared so types still work, as the index allows. Run `npm test`: all existing tests must still pass with the new migration.
- [ ] **Step 5: Write the failing op tests** in `src/lib/ops/search.test.ts`. Seed:
  - A system "Search index" with summary "rebuild on every write".
  - Spec v1 "old wording nightly" and spec v2 "rebuild in the transaction".
  - ADR "Use SSE for live boards".
  - Question "Should exports include archived rows?".
  - Page "onboarding" with body "run npm ci".

  Expect:
  - `q: "rebuil"` → hits of kind `system` and `spec`. The spec hit is v2 only (no hit for the v1 words), and its snippet contains `\u0002rebuild\u0003`.
  - `q: "nightly"` → no spec hit (only the old version has it).
  - `q: "sse"` → the ADR hit with `href` `/p/demo/adrs/1`.
  - `q: "npm"` → the page hit.
  - `kinds: ["question"]` with `q: "exports"` → only the question.
  - `q: "a"` → `[]` with no query issued. Assert it returns quickly; no spy is needed.
  - A non-member → `NotFoundError`.
  - An archived system's hits are left out (set `archivedAt` directly in the db).
- [ ] **Step 6: Implement `searchProject`** as one `union all` query per kind, merged and ordered in SQL, with `limit`. Run the tests. Expected: PASS.
- [ ] **Step 7: Wire the adapters.**
  - Tool `search` (GET `/projects/:project/search`, read), input `{ ...P, ...searchProjectInput.shape }`, with description "Full-text search in a project's systems, latest specs and plans, ADRs, questions and pages; returns titles, links and short snippets."
    - For agents, strip the `\u0002`/`\u0003` markers from snippets and replace them with `**` in the tool's `run`.
    - Leave out `href` and return `{ kind, title, ref, snippet }`, where `ref` is the slug or number an agent passes to other tools (system slug, ADR number, question id, page slug).
  - tRPC: `search.project({ project, q, kinds?, limit? })` returns `SearchHit[]` with the markers intact.
- [ ] **Step 8: Integrate the command menu.**
  - When `data.project` is set and the input has at least 2 non-space characters, debounce 200 ms, then query `search.project` with `placeholderData: keepPreviousData`.
  - Render a "In documents" group. Each hit is a `CommandItem` with `value={`hit ${hit.kind} ${hit.href}`}` and `keywords={[query]}`, so cmdk's own filter doesn't hide it.
  - Show the kind icon, the title and the snippet on a second line. The snippet is rendered by splitting on `\u0002`/`\u0003` into text and `<mark>` elements, never as HTML.
  - While loading, show a muted "Searching…" row. With zero hits, the existing "Nothing matches." empty state still shows.
- [ ] **Step 9: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: green.
- [ ] **Step 10: Commit** with message `feat(search): full-text search in documents from the command menu`.
