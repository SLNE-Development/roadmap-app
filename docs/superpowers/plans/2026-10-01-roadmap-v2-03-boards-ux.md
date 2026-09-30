# roadmap-app v2, Part 3: Boards and UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make boards and the everyday screens faster to work with. This part covers:
- moving cards by keyboard and touch;
- swimlanes;
- per-board card fields;
- board filters in the URL, with one shared filter chip;
- server-side "Needs attention" with stale-work alerts;
- project health on home cards;
- a personal My work inbox;
- a team workload page;
- bulk edit on the systems table;
- saved views;
- per-person overview panels;
- global keyboard shortcuts.

**Architecture:** New logic goes into ops modules (`src/lib/ops/attention.ts`, `health.ts`, `my-work.ts`, `workload.ts`, `saved-views.ts`), exposed through tRPC. Only `my_work` becomes an MCP tool. Filter state that should be shareable (board filters, lanes) lives in the URL. Personal choices (overview panels, the My work "seen" time) live in `user_pref` from Part 1. Pure helpers hold the UI logic, so it can be unit-tested in vitest's Node environment, which has no DOM.

**Tech Stack:** the v2 index stack. No new runtime dependencies in this part.

**Spec:** none for v2 (see the index). This part implements the items under "Improve existing: Boards / Systems / Activity, overview and roadmap" and "New features: Tracking work" of the user's pick list, reproduced in the Goal above.

## Global Constraints

- Everything in `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` → Global Constraints applies. The most important points:
  - Ops-layer rule: `(db, actor, …)`, a zod `<name>Input`, one transaction, and `logChange` for every changed field.
  - tRPC routers for the UI; a tool only where agents need it; short tool descriptions.
  - vitest on PGlite, with no Valkey.
  - shadcn/ui only; never hand-edit `src/components/ui/`.
  - Commits: `type(scope): lowercase description` plus the `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` trailer, one commit per task.
- Viewers read, editors change content, owners manage boards and settings. Board card fields are an owner setting. Saved views, overview panels and My work are personal to the actor, and they work in every project the actor can see.
- Personal data (`saved_view`, `user_pref`) is **not** written to `change_log`. Everything project-wide is.
- The vitest environment is `node`. There is no DOM and no React Testing Library, so UI logic is tested through pure functions. Components are only render-tested with `renderToStaticMarkup` where markup matters (as `src/components/markdown.test.tsx` does).
- Constants this part exports and later parts read: `STALE_SYSTEM_DAYS = 7`, `STALE_QUESTION_DAYS = 5`, `HEALTH_QUIET_DAYS = 14` (all in `src/lib/ops/attention.ts`).

### Names assumed from Part 2

Part 2 (`2026-10-01-roadmap-v2-02-work-data.md`) is written in parallel with this part. This plan relies on the Part 2 names below. **Before starting each task, open Part 2 and use its exact names wherever they differ from this list.** Each use in this plan is marked "(Part 2)".

| Assumed name | Meaning |
| --- | --- |
| `task.blockedReason: text \| null` | why a blocked task waits |
| `task.estimate: "S" \| "M" \| "L" \| null` and `ESTIMATE_POINTS = { S: 1, M: 3, L: 8 }` | task sizes and their points |
| `system.archivedAt`, `project.archivedAt: timestamptz \| null` | archive; archived rows are left out of every list in this part |
| `question.priority: "blocking" \| "normal" \| "nice"` | question priority |
| `customField` table (`id, projectId, key, name, type, options, sortOrder`), `listCustomFields(db, actor, projectSlug)`, and `SystemListItem.fields: Record<string, string>` keyed by field **key** | custom fields and their values per system |
| `systemDependency` table (`systemId, dependsOnId`), `SystemListItem.blockedBy: string[]` (slugs of unfinished dependencies) | "blocked by" links |
| `SystemListItem.points`, `pointsDone`, `unestimated` (from `systemRollups`) | estimate rollups per system |

If Part 2 has not landed yet when a task needs one of these, stop and implement Part 2 first. The index orders Part 2 before Part 3.

## Review Focus

1. **A keyboard or touch move into a column the planning gate refuses:** the card snaps back, keyboard focus stays on the same card, and a polite live region reads the refusal ("search-index can't leave planning yet."). The toast from the mutation cache still shows. Pinned in Task 3.2: `moveTargets` tests and a `BoardAnnouncer` render test.
2. **Bulk edit where one of 20 systems fails** (planning gate, unknown column, a non-member as owner): nothing changes, and the error names every failing system. Pinned in Task 3.9 (`updateSystems` all-or-nothing test).
3. **A saved view pointing at a project the user has since lost access to, or that was archived:** the view is left out of the sidebar, and `listSavedViews` does not return it for that project. It never reveals the project's name. Opening its URL still gives the normal 404. Pinned in Task 3.10.
4. **Shortcuts pressed while typing** (input, textarea, select, contenteditable, the ⌘K dialog, any open dialog), or with Ctrl, Meta or Alt held: ignored, so typing "g" in the search box never navigates. Pinned in Task 3.12 (`isTypingTarget` and `ShortcutMatcher` tests).
5. **My work and workload for a user removed from a project, or whose account was removed:** nothing from that project appears. An admin who is not a member sees only their own member projects. Pinned in Task 3.7 and Task 3.8 visibility tests.

---

### Task 3.1: URL board filters and one shared filter chip

The app has three chip components today:
- a private `FilterChip` in `src/components/board-view.tsx` (local state);
- `FilterChip` in `src/components/systems/systems-toolbar.tsx` (URL; brand-soft with an X);
- `FilterChip` / `ToggleChip` in `src/components/activity/filter-chip.tsx` (links; solid, no X).

They look and clear differently. Replace all three with one component. Move board filters into the URL so a filtered board can be shared.

**Files:**
- Create: `src/components/filter-chip.tsx`
- Create: `src/lib/url-filters.ts`, `src/lib/url-filters.test.ts`
- Modify: `src/components/board-view.tsx` (drop the local chip and the `filters` / `query` state; read from props)
- Modify: `src/app/(app)/p/[project]/boards/[board]/page.tsx`, `board-page-view.tsx` (accept `searchParams`, pass the parsed filters down)
- Modify: `src/components/systems/systems-toolbar.tsx` (use the shared chip; keep `FilterDef` exported)
- Modify: `src/app/(app)/p/[project]/activity/activity-view.tsx`, `src/app/(app)/p/[project]/questions/questions-view.tsx` (use the shared chip)
- Delete: `src/components/activity/filter-chip.tsx`. Move `ToggleChip` into `src/components/filter-chip.tsx` with the same look as the new chip.

**Interfaces:**
- Produces, in `src/lib/url-filters.ts`:
  - `BOARD_FILTER_KEYS = ["q", "domain", "phase", "priority", "owner", "lane"] as const`
  - `type BoardQuery = { q: string; domain: string | null; phase: string | null; priority: Priority | null; owner: string | null; lane: LaneKey }`, where `LaneKey` comes from Task 3.3. Until Task 3.3 lands, declare `lane` as `"none"` only.
  - `parseBoardQuery(sp: Record<string, string | string[] | undefined>): BoardQuery`. Unknown or invalid values become `null` (or `"none"` for `lane`); the first element is used when a value is an array; `q` is trimmed and capped at 100 characters; `priority` must be one of `PRIORITIES`.
  - `withParam(search: string, key: string, value: string | null): string`. Returns the new query string, with a leading `?` or empty. Setting `null` or `""` removes the key; the other keys keep their order.
  - `hasFilters(query: BoardQuery): boolean`. True when any key except `lane` is set.
- Produces, in `src/components/filter-chip.tsx`:
  - `FilterChip({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void })`. Unset: dashed border and a chevron. Set: `border-primary bg-brand-soft text-brand-strong font-medium`, showing `"<label>: <option>"`, with an X button labelled `Clear <label lowercase> filter`. The menu has an "Any" item at the top, as the systems toolbar chip does today. When `options` is empty, the menu shows "Nothing to filter by yet".
  - `ToggleChip({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void })`, with the same set and unset looks and `aria-pressed`.
  - URL-driven callers pass `onChange` handlers that call `router.replace(pathname + withParam(...), { scroll: false })` inside `startTransition`. The component knows nothing about URLs.

- [ ] **Step 1: Write failing tests for `parseBoardQuery`, `withParam` and `hasFilters`**
  - `parseBoardQuery({ q: "  search ", priority: "MVP", owner: "none" })` returns `q: "search"`, `priority: "MVP"`, `owner: "none"`, `domain: null`, `phase: null` and `lane: "none"`.
  - `parseBoardQuery({ priority: "urgent", lane: "colour" })` returns `priority: null` and `lane: "none"`.
  - `parseBoardQuery({ domain: ["a", "b"] })` returns `domain: "a"`.
  - A `q` of 300 characters comes back as 100 characters.
  - `withParam("?q=x&domain=d", "domain", null)` returns `"?q=x"`.
  - `withParam("", "phase", "p1")` returns `"?phase=p1"`.
  - `withParam("?q=x", "q", "")` returns `""`.
  - `hasFilters(parseBoardQuery({ lane: "domain" }))` is `false`; with `{ q: "a" }` it is `true`.
- [ ] **Step 2: Run the tests and see them fail**: `npx vitest run src/lib/url-filters.test.ts`. They fail with "Failed to resolve import".
- [ ] **Step 3: Implement `src/lib/url-filters.ts`.** Build `withParam` on `URLSearchParams`, so values are encoded.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Create `src/components/filter-chip.tsx`.** Move the systems-toolbar chip's markup into `FilterChip` with the props above, and add `ToggleChip`.
- [ ] **Step 6: Move the board to the URL.**
  - `page.tsx` receives `searchParams: Promise<Record<string, string | string[] | undefined>>` and passes `query={parseBoardQuery(await searchParams)}` to `BoardPageView`, which forwards it to `BoardView`.
  - In `BoardView`, remove `useState` for `query` and `filters`. Filtering reads `props.query`.
  - The search input keeps a local draft that is replaced into the URL after 250 ms of no typing. Key the input on `query.q`, so back and forward and "Clear filters" reset it. This also fixes the systems-toolbar drift noted in Part 0: apply the same `key={current.q}` fix there if Part 0 has not.
  - Add a "Clear filters" text button, shown when `hasFilters(query)`, that replaces the URL with only `lane` kept.
- [ ] **Step 7: Swap the systems toolbar, activity and questions views to the shared chip.** Activity and questions currently render `<Link>` options. Replace those with `onChange` handlers that call `router.replace` with the same query the links used. The clear action must produce exactly the old `clearHref`.
- [ ] **Step 8: Delete `src/components/activity/filter-chip.tsx`, then run** `npm run lint && npm run typecheck && npx vitest run`. Expect all green and no remaining imports of the deleted file (`grep -rn "activity/filter-chip" src` prints nothing).
- [ ] **Step 9: Check by hand in `npm run dev`:**
  - On a board, set Domain, reload: the filter is still applied.
  - Press back: the filter is removed.
  - Chips on Board, Systems, Activity and Questions look the same.
- [ ] **Step 10: Commit.** `git add -A && git commit` with message `feat(ui): keep board filters in the url and share one filter chip`, plus the trailer.

---

### Task 3.2: Move cards by keyboard and touch

Each card already has a "Move to…" menu (`ArrowRightLeft` button in `SystemCard`). Two things are missing:
- **Keyboard moves:** cards aren't focusable, and there are no arrow-key moves.
- **Touch moves:** native HTML5 drag does nothing on iOS or Android.

**Files:**
- Create: `src/lib/board-moves.ts`, `src/lib/board-moves.test.ts`
- Create: `src/components/board/use-pointer-drag.ts`
- Create: `src/components/board/board-announcer.tsx`, `src/components/board/board-announcer.test.tsx`
- Modify: `src/components/board-view.tsx`: make `SystemCard` focusable, add key handling and pointer dragging, and put `data-column-id` on each column `<section>`

**Interfaces:**
- Produces, in `src/lib/board-moves.ts`:
  - `moveTargets(columns: { id: string }[], currentColumnId: string): { left: string | null; right: string | null }`. The neighbouring column ids in board order; `null` at either end.
  - `moveKey(event: { key: string; altKey: boolean; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): "left" | "right" | null`. Returns `"left"` or `"right"` only for `Alt+ArrowLeft` / `Alt+ArrowRight` with no other modifier. On macOS the Alt key is Option, which is the same `altKey`.
  - `columnIdAt(point: { x: number; y: number }, hit: (x: number, y: number) => Element | null): string | null`. Walks up from `hit(x, y)` to the nearest element with `data-column-id` and returns its value. Tests pass a fake `hit`; the browser passes `document.elementFromPoint`.
  - `LONG_PRESS_MS = 250` and `DRAG_SLOP_PX = 8`.
- Produces, in `src/components/board/use-pointer-drag.ts`:
  - `usePointerDrag({ enabled, onDrop }: { enabled: boolean; onDrop: (slug: string, columnId: string) => void }): { bind: (slug: string) => React.HTMLAttributes<HTMLElement>; draggingSlug: string | null; overColumnId: string | null }`.
  - It only reacts when `pointerType !== "mouse"`, because mouse users keep native drag.
  - A drag starts after the pointer has been held for `LONG_PRESS_MS` without moving more than `DRAG_SLOP_PX`. Moving earlier cancels the press, so the page can scroll.
  - While dragging: `setPointerCapture`, `touch-action: none` on the card, and `overColumnId` from `columnIdAt`.
  - It auto-scrolls the board's scroll container horizontally when the pointer is within 40 px of its left or right edge.
  - `pointerup` calls `onDrop` if `overColumnId` is set; `pointercancel` does nothing.
- Produces, in `src/components/board/board-announcer.tsx`:
  - `BoardAnnouncer({ message }: { message: string })`: an `sr-only` element with `aria-live="polite"` and `aria-atomic="true"`.
  - Export `moveMessage(title: string, columnName: string): string`, which returns `"Moved <title> to <columnName>."`, and `refusedMessage(title: string, reason: string): string`, which returns `"<title> stayed put: <reason>"`.

- [ ] **Step 1: Write failing tests in `src/lib/board-moves.test.ts`.**
  - `moveTargets([{id:"a"},{id:"b"},{id:"c"}], "b")` returns `{ left: "a", right: "c" }`.
  - With `"a"` it returns `left: null`; with `"c"` it returns `right: null`.
  - `moveKey` returns `"right"` for `{ key: "ArrowRight", altKey: true }` and `null` for plain `ArrowRight`, for `Alt+Shift+ArrowRight` and for `Ctrl+Alt+ArrowLeft`.
  - `columnIdAt` with a fake element tree (objects with `getAttribute` and `parentElement`) returns the nearest ancestor's `data-column-id`, and `null` when there is none.
- [ ] **Step 2: Write a failing render test in `board-announcer.test.tsx`.**
  - `renderToStaticMarkup(<BoardAnnouncer message="Moved A to Review." />)` contains `aria-live="polite"` and the text.
  - `moveMessage("A", "Review")` is `"Moved A to Review."`.
- [ ] **Step 3: Run** `npx vitest run src/lib/board-moves.test.ts src/components/board/board-announcer.test.tsx`. Both fail.
- [ ] **Step 4: Implement `board-moves.ts` and `board-announcer.tsx`.**
- [ ] **Step 5: Implement `use-pointer-drag.ts`** as specified above. Keep it free of board knowledge.
- [ ] **Step 6: Wire it into `board-view.tsx`.**
  - `SystemCard`'s `<article>` gets:
    - `tabIndex={0}`;
    - `data-nav-item` (used by j/k in Task 3.12);
    - `aria-roledescription="card"`;
    - `aria-label="<title>, <column name>"`;
    - a visible focus ring (`focus-visible:ring-3 focus-visible:ring-ring/50 outline-none`).
  - `onKeyDown`:
    - `Enter` navigates to the system page.
    - `moveKey(e)` of `left` or `right` calls `e.preventDefault()`, then `move(slug, target)` when the target is not null.
  - After a move, re-focus the same card in its new column. Use a `focusSlug` ref consumed in a `useEffect` after render; find the card by `[data-card-slug="<slug>"]`, an attribute added to each card.
  - Spread `bind(slug)` from `usePointerDrag` on each card (only when `canEdit`), with `onDrop = move`.
  - Treat `overColumnId` like the existing HTML5 `dragOver` so the "Drop to move to …" placeholder appears.
  - Change `move` to return the result: on success, set `announce` to `moveMessage(...)`; on failure, set `refusedMessage(title, error.message)`. Render `<BoardAnnouncer message={announce} />` once in `BoardView`.
  - Show a small hint under the filter bar on the first focus of a card only: "Alt+← / Alt+→ moves a card". Store the dismissal in `localStorage` key `roadmap.hint.cardMove`, wrapped in try/catch.
- [ ] **Step 7: Run** `npm run lint && npm run typecheck && npx vitest run`. All green.
- [ ] **Step 8: Check by hand.**
  - Tab to a card, press Alt+→: the card moves and keeps focus.
  - Alt+→ out of planning on a system whose planning is incomplete: the card stays and the refusal toast shows.
  - In Chrome DevTools device mode (touch), long-press a card and drag it to another column: the card moves. A quick swipe scrolls the board instead.
  - Desktop mouse drag still works.
- [ ] **Step 9: Commit** `feat(boards): move cards by keyboard and touch`, plus the trailer.

---

### Task 3.3: Swimlanes

**Files:**
- Create: `src/lib/lanes.ts`, `src/lib/lanes.test.ts`
- Modify: `src/lib/url-filters.ts` (`lane` accepts `LaneKey`), `src/lib/url-filters.test.ts`
- Modify: `src/components/board-view.tsx`: add a lane picker and lane rows

**Interfaces:**
- Produces, in `src/lib/lanes.ts`:
  - `LANE_KEYS = ["none", "domain", "phase", "owner", "priority"] as const` and `type LaneKey = (typeof LANE_KEYS)[number]`.
  - `interface Lane { key: string; name: string; cards: BoardCardView[]; countByColumn: Record<string, number> }`. `key` is the group value, or `"__none"` for "No domain", "No phase" or "Unassigned".
  - `groupIntoLanes(cards: BoardCardView[], by: LaneKey, names: { domains: Map<string, string>; phases: Map<string, string>; phaseOrder: string[]; domainOrder: string[] }): Lane[]`.
  - Ordering:
    - `none` gives one lane with key `"all"` and an empty name.
    - `domain` and `phase` lanes follow `domainOrder` / `phaseOrder` (the structure's sort order), with the "No …" lane last.
    - `owner` lanes sort by owner name, with "Unassigned" last.
    - `priority` lanes follow `PRIORITIES` order.
  - Lanes with no cards are left out. `countByColumn` counts the lane's cards per `columnId`.
- Consumes: `BoardCardView` from `src/components/board-view.tsx`. Move that interface to `src/lib/board-card.ts` so `src/lib` does not import a client component; `board-view.tsx` re-exports it.

- [ ] **Step 1: Write failing tests in `lanes.test.ts`.** Use five cards across two domains, one with no domain, and two owners.
  - `groupIntoLanes(cards, "domain", …)` returns lanes in `domainOrder` with "No domain" last, and each lane's `countByColumn` matches.
  - `"owner"` puts "Unassigned" last.
  - `"priority"` follows `MVP`, `Later`, `Nice to have`, and skips any priority with no cards.
  - `"none"` returns a single lane with all cards.
- [ ] **Step 2: Extend the `url-filters` tests.** `parseBoardQuery({ lane: "owner" }).lane` is `"owner"`; `{ lane: "x" }` gives `"none"`.
- [ ] **Step 3: Run the tests and see them fail.**
- [ ] **Step 4: Implement `lanes.ts`, move `BoardCardView` to `src/lib/board-card.ts`, and widen `BoardQuery.lane` to `LaneKey`.**
- [ ] **Step 5: Render lanes in `board-view.tsx`.**
  - Add a "Lanes" dropdown (`DropdownMenuRadioGroup`) next to the view toggle, with the options None, Domain, Phase, Owner and Priority. It writes `lane` to the URL.
  - When `lane !== "none"`, render one row per lane. Each row has a sticky header bar, full width and collapsible, showing the lane name, total count and `countByColumn` as small numbers aligned over each column. Below it, the columns hold only that lane's cards.
  - Column headers (name, count, collapse) are rendered once at the top and stay sticky vertically. Collapsed columns stay collapsed across all lanes.
  - Lane collapse state is kept per board in `user_pref` key `board.collapsed.<boardId>` as `{ columns: string[]; lanes: string[] }`, through the prefs router from Task 3.11. Until Task 3.11 lands, keep lane collapse in component state, and switch to the pref in 3.11 Step 6.
  - Dropping a card in another lane changes only its column, never its domain, phase, owner or priority. Say so in the lane picker's menu footnote: "Dragging across lanes changes only the column."
- [ ] **Step 6: Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 7: Check by hand.**
  - Pick Lanes → Owner: rows appear per owner, and each lane's counts add up to the column totals.
  - Reload: the lanes are kept, because they're in the URL.
- [ ] **Step 8: Commit** `feat(boards): add swimlanes by domain, phase, owner or priority`, plus the trailer.

---

### Task 3.4: Choose card fields per board

**Files:**
- Modify: `src/db/schema/projects.ts`: add `board.cardFields` as `jsonb("card_fields").$type<string[]>().notNull().default(sql\`'["owner","tasks","blocked"]'::jsonb\`)`, the fields cards show today
- Generate: `npm run db:generate -- --name board-card-fields`
- Create: `src/lib/card-fields.ts`, `src/lib/card-fields.test.ts`
- Modify: `src/lib/ops/boards.ts` (new op `setBoardCardFields`, input `cardFieldsInput`), `src/lib/ops/boards.test.ts`
- Modify: `src/lib/ops/systems.ts`: `SystemListItem` gains `openQuestions: number` (the estimate, dependency and custom-field values come from Part 2's `points`/`pointsDone`, `blockedBy` and `fields`)
- Modify: `src/lib/ops/systems.test.ts`
- Modify: `src/server/trpc/routers/boards.ts` (`setCardFields` mutation)
- Modify: `src/components/board-view.tsx`: render only the chosen fields, and add a "Card fields…" item in the Board options menu (owner only)
- Create: `src/components/board/card-fields-dialog.tsx`

**Interfaces:**
- Produces, in `src/lib/card-fields.ts`:
  - `BUILTIN_CARD_FIELDS = ["owner", "tasks", "blocked", "phase", "domain", "priority", "questions", "estimate", "dependencies", "gates"] as const`. `gates` renders nothing until Part 4 fills `SystemListItem.gateStatus`. The field is listed now so boards can switch it on in advance. Mark it "(after column gates)" in the dialog while Part 4 has not landed; test for this with `"gateStatus" in item`.
  - `type CardField = (typeof BUILTIN_CARD_FIELDS)[number] | \`custom:${string}\``, where the part after `custom:` is the custom field **key** (Part 2 `custom_field.key`), not its id.
  - `normalizeCardFields(raw: unknown, customFieldKeys: string[]): CardField[]`: drops unknown values, duplicates and custom fields that no longer exist; keeps order; caps at 8.
- Produces, in `src/lib/ops/boards.ts`:
  - `cardFieldsInput = z.object({ fields: z.array(z.string().min(1).max(80)).max(8) })`.
  - `setBoardCardFields(db, actor, projectSlug, boardSlug, raw): Promise<string[]>`, owner only. It normalizes against the project's custom fields (Part 2 `customField`) and throws `InvalidError("Unknown card field <x>.")` for a value normalization would drop. It logs `entity: "board", field: "cardFields"` with old and new values as comma-joined strings.
  - `listBoards` and `getProject(...).boards[i]` include `cardFields: CardField[]`.
- `SystemListItem`, extended in `listSystems` with grouped queries (no per-row queries):
  - `openQuestions`: unresolved questions whose `systemId` is the system.
  - The `estimate` card field shows `points - pointsDone` open points (Part 2 `SystemListItem.points` / `pointsDone`).
  - The `dependencies` card field shows `blockedBy.length` and lists the slugs in a tooltip (Part 2 `SystemListItem.blockedBy`).
  - Custom card fields read `item.fields[<key>]` (Part 2 `SystemListItem.fields`).
- tRPC: `boards.setCardFields` with input `{ project, board, fields: string[] }`.

- [ ] **Step 1: Write failing unit tests in `card-fields.test.ts`.**
  - `normalizeCardFields(["owner","owner","bogus","custom:f1","custom:gone"], ["f1"])` returns `["owner","custom:f1"]`.
  - Non-array input returns `[]`.
  - Ten valid fields come back as eight.
- [ ] **Step 2: Write failing op tests in `boards.test.ts`.**
  - An owner sets `["phase","questions"]`; `listBoards` returns them.
  - An editor gets 403.
  - `["nope"]` gives 400 with the message `Unknown card field nope.`
  - One `change_log` row exists with `field = "cardFields"`.
- [ ] **Step 3: Write a failing `listSystems` test in `systems.test.ts`.** Create a system with two open questions, one resolved question, and tasks with estimates M (todo), L (done) and S (doing). Expect `openQuestions: 2`, and Part 2's `points: 12` and `pointsDone: 8`, so the card's estimate field shows 4 open points.
- [ ] **Step 4: Run the tests and see them fail.**
- [ ] **Step 5: Add the column and generate the migration.** Implement the helper, the op, the `listSystems` fields and the router.
- [ ] **Step 6: Build the owner dialog `card-fields-dialog.tsx`.** It's a list of switches (the shadcn `switch`; add it with `npx shadcn@latest add switch` if missing) with up and down buttons for order, including the project's custom fields as `custom:<id>` labelled with their names. Cards render the fields in the chosen order:

  | Field | Renders |
  | --- | --- |
  | `owner` | avatar |
  | `tasks` | progress bar |
  | `blocked` | the current blocked reason row |
  | `phase` / `domain` / `priority` | chips |
  | `questions` | "? 2" |
  | `estimate` | "8 pts" |
  | `dependencies` | "Waiting on 1" |
  | `custom:<id>` | "<name>: <value>" |
- [ ] **Step 7: Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 8: Commit** `feat(boards): choose which fields cards show per board`, plus the trailer.

---

### Task 3.5: Needs attention on the server, with stale-work alerts

The attention list is built in the browser today (`src/app/(app)/p/[project]/overview-view.tsx`, lines 102–142), with a 3-day question threshold. Move it to an op, so the overview, project health (3.6) and My work (3.7) share one set of rules, and add stale alerts.

**Files:**
- Create: `src/lib/ops/attention.ts`, `src/lib/ops/attention.test.ts`
- Modify: `src/components/overview/attention-list.tsx`: add the `stale` and `blocked-task` kinds
- Modify: `src/server/trpc/routers/projects.ts`: add the `attention` query
- Modify: `src/app/(app)/p/[project]/overview-view.tsx` and `page.tsx`: prefetch and render `projects.attention`, and delete the client-side builder, `isStale` and `QUESTION_AGE_MS`

**Interfaces:**
- Produces, in `src/lib/ops/attention.ts`:
  - `STALE_SYSTEM_DAYS = 7`, `STALE_QUESTION_DAYS = 5`, `HEALTH_QUIET_DAYS = 14`.
  - `type AttentionKind = "blocked" | "blocked-task" | "stale" | "planning" | "decision" | "question"`.
  - `interface AttentionItem { key: string; kind: AttentionKind; title: string; detail: string; href: string; at: Date | null; systemId: string | null }`.
  - `projectAttention(db: Executor, actor: Actor, projectSlug: string, now: Date): Promise<AttentionItem[]>`, viewer or higher.
  - `lastActivityBySystem(db: Executor, projectId: string): Promise<Map<string, Date>>`: the newest of `progress_update.createdAt` and `change_log.createdAt` for each system, from two grouped queries. Exported for Task 3.6.
- Rules, in output order. Every rule skips archived systems (Part 2 `system.archivedAt`).
  1. `blocked`: each system in a `blocked`-category column. Detail: its latest update's summary plus age, or "No update explains why yet."
  2. `blocked-task`: each task in state `blocked` (Part 2 `task.blockedReason`). Title: `Task #<id> is blocked`. Detail: `"<system title> · <reason or 'no reason given'>"`. Href: the system page. At most 20, oldest first.
  3. `stale`: each system in an `active`- or `review`-category column whose `lastActivityBySystem` is older than `now - STALE_SYSTEM_DAYS days`. Title: `<title> has had no update for <n> days`. Href: the system page.
  4. `planning`: each system in a planning column (same detail as today, from `planningGaps`).
  5. `decision`: each proposed ADR.
  6. `question`: each unresolved question that is either older than `STALE_QUESTION_DAYS` days, or has `priority = "blocking"` (Part 2) at any age. Blocking questions sort first and get the detail prefix "Blocking · ". Href: `/p/<slug>/questions?system=<systemSlug>` when the question has a system, otherwise `/p/<slug>/questions`.
- The `AttentionList` component imports the type from the op module (type-only import). Style the new kinds: `blocked-task` like `blocked` with the `ListX` icon; `stale` with the `Hourglass` icon and the `bg-cat-review-soft text-cat-review` colours.
- tRPC: `projects.attention({ project })`, which passes `now = new Date()`. The server render's clock is fine, since items carry `at` and the client formats ages with `useNow()`.

- [ ] **Step 1: Write failing PGlite tests in `attention.test.ts`.** Use a fixed `now = new Date("2026-10-10T12:00:00Z")` and insert `createdAt` values directly.
  - An active-column system whose last update is 8 days old appears as `stale`; one with a `change_log` entry 2 days old does not.
  - A review-column system with no update for 10 days is stale; a todo-column system with no update for 30 days is **not** stale.
  - A question 4 days old with normal priority is absent; the same question with `priority: "blocking"` is present, sorted before a 6-day-old normal question, with detail starting `Blocking · `.
  - A blocked task with reason "waiting for API key" gives `kind: "blocked-task"` with that reason in the detail.
  - An archived system produces no item.
  - A non-member gets 404.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/attention.test.ts`. It fails.
- [ ] **Step 3: Implement the op.** Reuse `planningGaps` from `src/lib/ops/planning.ts`. If Part 0 added a batched gaps function, use it instead of calling per system.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Wire the overview.** Add `trpc.projects.attention` to the page prefetch and the view's `useSuspenseQueries`. Delete the old builder, and drop `planning.gaps` from the overview if nothing else there uses it.
- [ ] **Step 6: Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 7: Commit** `feat(overview): compute needs attention on the server and flag stale work`, plus the trailer.

---

### Task 3.6: Project health on home cards

**Files:**
- Create: `src/lib/health.ts`, `src/lib/health.test.ts`
- Modify: `src/lib/ops/summaries.ts`: `ProjectSummary` gains `health: ProjectHealth`
- Modify: `src/lib/ops/summaries.test.ts`
- Modify: `src/app/(app)/(global)/project-grid.tsx` and `home-view.tsx`: show a health badge with a tooltip listing the reasons

**Interfaces:**
- Produces, in `src/lib/health.ts` (pure):
  - `type HealthStatus = "on-track" | "at-risk" | "stalled" | "empty"`.
  - `interface HealthInput { systems: number; notDone: number; blocked: number; activeOrReview: number; staleSystems: number; blockingQuestions: number; lastChange: Date | null; now: Date }`.
  - `interface ProjectHealth { status: HealthStatus; reasons: string[] }`.
  - `projectHealth(input: HealthInput): ProjectHealth`. The exact rule, checked in this order:
    1. `systems === 0` → `empty`, with no reasons.
    2. `notDone === 0` → `on-track`, reason `"Everything is done."`.
    3. **Stalled** when any of these holds, with each true one added as a reason:
       - `lastChange` is null or older than `HEALTH_QUIET_DAYS` days: `"No changes for <n> days."`;
       - `activeOrReview > 0 && staleSystems / activeOrReview >= 0.5`: `"<k> of <m> systems in progress have gone quiet."`.
    4. **At risk** when any of these holds, with each true one added as a reason:
       - `blocked >= 1 && blocked / notDone >= 0.2`: `"<b> of <notDone> open systems are blocked."`;
       - `staleSystems >= 1`: `"<k> systems have had no update for 7+ days."`;
       - `blockingQuestions >= 1`: `"<q> blocking questions are open."`.
    5. Otherwise `on-track`, with no reasons.
- `projectSummaries` computes the inputs with grouped queries across all ids:
  - `notDone`, `blocked` and `activeOrReview` from the existing category counts;
  - `staleSystems` from one query using `lastActivityBySystem` logic generalized to many projects (add `lastActivityBySystemMany(db, projectIds)` in `attention.ts`);
  - `blockingQuestions` from unresolved questions with `priority = "blocking"` (Part 2).
  - Archived systems are left out, and archived projects are already left out by `listProjects` (Part 2).
- UI: a badge in the card's top row.

  | Status | Label | Colour |
  | --- | --- | --- |
  | `on-track` | On track | `bg-cat-done-soft text-cat-done` |
  | `at-risk` | At risk | `bg-cat-review-soft text-cat-review` |
  | `stalled` | Stalled | `bg-cat-blocked-soft text-cat-blocked` |

  `empty` shows no badge. The badge carries `aria-label="Health: <label>. <reasons joined by space>"` and a shadcn `Tooltip` showing the reasons as a list. The grid's sort menu gains "Health" (stalled, then at risk, then on track, then empty; ties by recent activity).

- [ ] **Step 1: Write failing unit tests for `projectHealth`**, one per rule and branch, including the boundaries:
  - `blocked / notDone` of exactly 0.2 → at risk; 0.19 → on track.
  - Stale ratio of exactly 0.5 → stalled.
  - `lastChange` exactly 14 days old → stalled; 13.9 days → not stalled.
  - Two stalled reasons at once → both listed.
- [ ] **Step 2: Write a failing test in `summaries.test.ts`.** A project with one blocked system out of three not-done systems gets `health.status === "at-risk"`.
- [ ] **Step 3: Run the tests and see them fail. Implement. Run them and see them pass.**
- [ ] **Step 4: Add the badge and the sort option, then run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 5: Commit** `feat(home): show project health on project cards`, plus the trailer.

---

### Task 3.7: My work inbox

**Files:**
- Create: `src/lib/ops/my-work.ts`, `src/lib/ops/my-work.test.ts`
- Modify: `src/server/trpc/routers/account.ts`: add the `myWork` query and the `markMyWorkSeen` mutation
- Modify: `src/lib/tools/definitions.ts`: add the tool `my_work`
- Modify: `src/lib/tools/registry.test.ts` (add `"my_work"` to `SPEC_TOOLS`)
- Create: `src/components/my-work-panel.tsx`
- Modify: `src/app/(app)/(global)/page.tsx`, `home-view.tsx`: prefetch and render the panel above the project grid

**Interfaces:**
- Produces, in `src/lib/ops/my-work.ts`:
  - `type MyWorkKind = "task" | "planning" | "question" | "decision" | "change"`. Part 6 adds `"mention"`, so keep the union and switch statements open for extension: render unknown kinds with a generic icon.
  - `interface MyWorkItem { key: string; kind: MyWorkKind; section: "waiting" | "changes"; projectSlug: string; projectName: string; systemSlug: string | null; title: string; detail: string; href: string; at: Date; agent: string | null; authorName: string | null }`.
  - `myWork(db: Executor, actor: Actor, opts: { now: Date; changesLimit?: number }): Promise<MyWorkItem[]>`. Waiting items come first (sorted as listed below), then changes, newest first. `changesLimit` defaults to 30 and is capped at 100.
  - `MY_WORK_SEEN_PREF = "mywork.seenAt"`, stored through Part 1's `getPref` / `setPref` as an ISO string.
  - `markMyWorkSeen(db: Db, actor: Actor, at: Date): Promise<void>`.
- Scope: only projects where the actor has an active membership, joined through `projectMember` → `user` → `allowedAccount`, the same way `isMember` checks it. Projects where the actor is only an admin are excluded; archived projects and archived systems are excluded (Part 2).
- **Waiting** sources, in this output order:
  1. `task`: tasks with `ownerUserId = actor`, state `blocked` first, then `doing`, each by `task.id`. Title: `#<id> <title>`. Detail: `"<system title> · blocked: <reason>"` or `"<system title> · in progress"`. Href: `/p/<slug>/systems/<system>`.
  2. `planning`: systems the actor owns in a planning-category column whose latest planning round has any `open` item. Title: `Planning round <n> has <k> open items`. Detail: the system title. Href: `?tab=planning`.
  3. `question`: unresolved questions on systems the actor owns whose author is someone else (or an agent), plus unresolved questions the actor asked that have an `answeredAt` after the seen time (detail "Answered, waiting for you to resolve"). Blocking priority (Part 2) sorts first. Href: `/p/<slug>/questions?system=<systemSlug>`.
  4. `decision`: proposed ADRs linked through `adr_system` to systems the actor owns. Href: `/p/<slug>/adrs/<number>`.
- **Changes**: `change_log` rows on systems the actor owns, newer than the seen time (or the last 7 days when there is none). Exclude rows authored by the actor with `agent IS NULL`; rows by the actor's own agent stay, since they are news to the person. Title: from `changeSentence` in `src/components/activity/change-sentence.ts`. Move that function, or a server-safe copy with the same output, into `src/lib/change-sentence.ts` if it imports client code. Detail: `"<system title> · <project name>"`. `authorName` and `agent` are filled in.
- tRPC:
  - `account.myWork()` returns `{ items: MyWorkItem[]; seenAt: Date | null }`;
  - `account.markMyWorkSeen()` stores `new Date()`.
- Tool `my_work`:
  - Description: `"What is waiting on you across your projects: your blocked and in-progress tasks, open planning items and questions on your systems, and proposed ADRs."`
  - No input.
  - Returns the waiting items only, as `{ kind, project, system, title, detail }[]` with no hrefs or dates, so agents read fewer tokens.

- [ ] **Step 1: Write failing PGlite tests in `my-work.test.ts`.** The fixtures are an owner and an editor Alice in project A, and Alice as a viewer in project B.
  - Alice owns a blocked task (reason "API key") and a doing task in A. `myWork` lists the blocked one first, with `section: "waiting"`, `kind: "task"`, and "blocked: API key" in the detail.
  - A question asked by the owner on Alice's system appears; a question Alice asked herself on her own system does not.
  - A proposed ADR linked to Alice's system appears; an accepted one does not.
  - A `change_log` row by the owner on Alice's system appears under `changes`. A row by Alice with no agent does not. A row by Alice with `agent: "Claude Code"` does.
  - After `markMyWorkSeen(at = T)`, only changes after T are listed.
  - After the owner removes Alice from A, nothing from A is listed.
  - After Alice's `allowed_account` row is deleted, `myWork` returns `[]`.
  - An archived system's items disappear.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Implement `my-work.ts`.** Use one query per source, each filtered by the actor's membership set, so there are no per-project loops.
- [ ] **Step 4: Run the tests and see them pass.**
- [ ] **Step 5: Add the tRPC procedures and the tool, and update `SPEC_TOOLS`. Run** `npx vitest run src/lib/tools src/lib/mcp`. Green.
- [ ] **Step 6: Build `my-work-panel.tsx`.**
  - Two `Panel` sections: "Waiting on you" (count) and "Since you were last here" (a "Mark all seen" button calling `markMyWorkSeen`).
  - Rows reuse the `AttentionList` row look: an icon square, title, detail, and the age from `useNow()`.
  - Agent-authored changes show "<agent> for <person>", as the activity timeline does.
  - The panel renders nothing when both sections are empty. The home page greeting line reads `"<n> things need you"`, or `"Nothing is waiting on you"` when there are none.
- [ ] **Step 7: Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 8: Commit** `feat(home): add a my work inbox and the my_work tool`, plus the trailer.

---

### Task 3.8: Team workload

**Files:**
- Create: `src/lib/ops/workload.ts`, `src/lib/ops/workload.test.ts`
- Modify: `src/server/trpc/routers/account.ts`: add the `workload` query
- Create: `src/app/(app)/(global)/workload/page.tsx`, `workload-view.tsx`
- Modify: `src/components/shell/app-sidebar.tsx`: add "Workload" to the global section list, below Projects

**Interfaces:**
- Produces, in `src/lib/ops/workload.ts`:
  - `interface WorkloadRow { userId: string; name: string; image: string | null; systemsOwned: number; systemsBlocked: number; tasksDoing: number; tasksBlocked: number; openPoints: number; projects: { slug: string; name: string; systems: number; tasksDoing: number }[] }`.
  - `teamWorkload(db: Executor, actor: Actor, opts: { project?: string }): Promise<WorkloadRow[]>`.
  - Scope: the projects where the actor is an active member (and `opts.project`, when given, must be one of them, otherwise 404).
  - Rows: every active member of those projects. Counts include only work in those projects.
    - `systemsOwned`: owned systems not in a done category.
    - `systemsBlocked`: owned systems in a blocked category.
    - `tasksDoing` / `tasksBlocked`: owned tasks in those states.
    - `openPoints`: the sum of `ESTIMATE_POINTS` (Part 2) over the member's not-done tasks.
  - Sort by `openPoints` descending, then `tasksDoing` descending, then name.
  - Archived projects and systems are left out.
- UI:
  - The page `/workload` has a table: person (avatar, name), systems, blocked, doing, points, and a bar of points relative to the maximum.
  - Rows expand to show per-project numbers with links to `/p/<slug>/systems?owner=<userId>`.
  - A project filter chip (the shared chip from 3.1) writes `?project=`.
  - A person over 2× the median `openPoints` gets an "Overloaded" chip (`bg-cat-review-soft`). Export this as a pure function `overloaded(rows: WorkloadRow[]): Set<string>` in `workload.ts` and unit-test it.

- [ ] **Step 1: Write failing tests.**
  - The actor sees members of shared projects only. Work in a project the actor is not in never counts, even for a shared member.
  - `opts.project` for a non-member project gives 404.
  - `openPoints` sums M + L = 11 for two open tasks and ignores done tasks.
  - `overloaded` with points `[1, 2, 3, 10]` flags only the member with 10 (the median is 2.5).
- [ ] **Step 2: Run the tests, see them fail, implement, and see them pass.**
- [ ] **Step 3: Add the page, the sidebar link and the prefetch in `page.tsx`**, following `src/app/(app)/(global)/settings/api-keys/page.tsx` as the pattern for a global page.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 5: Commit** `feat(workload): add a team workload page`, plus the trailer.

---

### Task 3.9: Bulk edit on the systems table

**Files:**
- Modify: `src/lib/ops/systems.ts`:
  - extract the body of `updateSystem` into `applySystemPatch(tx: Executor, actor: Actor, project: ProjectRow, parent: SystemRow, patch: z.output<typeof updateSystemInput>): Promise<SystemRow>`;
  - extract the body of `moveSystem` into `applySystemMove(tx: Executor, actor: Actor, project: ProjectRow, parent: SystemRow, to: z.output<typeof moveSystemInput>): Promise<SystemRow>`;
  - both old functions become wrappers that open the transaction and lock the row as today;
  - add `updateSystems` and `updateSystemsInput`.
- Modify: `src/lib/ops/systems.test.ts`
- Modify: `src/server/trpc/routers/systems.ts`: add the `bulkUpdate` mutation
- Modify: `src/components/systems/systems-table.tsx`: add a checkbox column and a selection header
- Create: `src/components/systems/bulk-bar.tsx`
- Modify: `src/app/(app)/p/[project]/systems/systems-view.tsx`: hold the selection state and render the bar

**Interfaces:**
- `updateSystemsInput = z.object({ systems: z.array(slugSchema).min(1).max(100), patch: z.object({ ownerUserId: z.string().min(1).nullable().optional(), phaseId: z.string().min(1).nullable().optional(), domainId: z.string().min(1).nullable().optional(), priority: z.enum(PRIORITIES).optional(), move: moveSystemInput.optional() }).refine(p => Object.values(p).some(v => v !== undefined), "Choose at least one change.") })`.
- `updateSystems(db, actor, projectSlug, raw): Promise<{ updated: string[] }>`, editor or higher. In one transaction:
  1. Lock every listed system (`FOR NO KEY UPDATE`) in slug order, so two bulk edits never deadlock.
  2. Apply `applySystemPatch`, then `applySystemMove` when `move` is set, to each one, collecting failures instead of throwing on the first: catch `OpError` per system and keep `"<slug>: <message>"`.
  3. If any failed, throw `ConflictError` (or `InvalidError` when every failure is a 400) with the message `"Nothing was changed. <n> systems failed: <joined failures>"`. The transaction rolls back.
  4. Unknown slugs count as failures (`"<slug>: not found"`) rather than a 404 for the whole call.
  5. Duplicated slugs in the input are removed first.
- The per-field change log is exactly what the single-system ops already write.
- tRPC: `systems.bulkUpdate({ project, input: updateSystemsInput })`.
- No MCP tool in this part. Agents rarely edit many systems at once, and Part 5 owns batch tools under the token budget rule. Note this in the op's doc comment: "Part 5 decides whether agents get a batch variant."
- UI:
  - A checkbox column in the systems table, with a header checkbox that selects the visible rows. Selection is cleared when filters change.
  - When the selection isn't empty, `bulk-bar.tsx` shows a sticky bar at the bottom of the viewport (`bottom-[calc(1rem+env(safe-area-inset-bottom))]`) with "<n> selected" and dropdowns for Owner, Phase, Domain, Priority and Move to (board columns grouped by board), plus Clear.
  - Choosing a value calls `bulkUpdate` immediately. On success: toast "Updated <n> systems" and clear the selection. On failure the mutation-cache toast shows the "Nothing was changed…" message.
  - The bar and the checkboxes are only shown to editors and owners.

- [ ] **Step 1: Write failing tests.**
  - `updateSystems` sets the phase on three systems: all change, and there are three `change_log` rows with `field: "phaseId"`.
  - `move` of three systems out of planning, where one has incomplete planning: nothing moves, the result is a 409, and the message names the failing slug and starts "Nothing was changed. 1 systems failed:".
  - A non-member `ownerUserId`: 400, and nothing changes.
  - An unknown slug in the list: 409 naming it, and nothing changes.
  - A viewer: 403.
  - An empty patch: 400 "Choose at least one change."
  - The existing `updateSystem` and `moveSystem` tests still pass unchanged.
- [ ] **Step 2: Run the tests and see them fail.**
- [ ] **Step 3: Refactor into `applySystemPatch` / `applySystemMove` (existing tests stay green), then implement `updateSystems`.**
- [ ] **Step 4: Run** `npx vitest run src/lib/ops/systems.test.ts`. Green.
- [ ] **Step 5: Add the router procedure and the UI. Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 6: Commit** `feat(systems): bulk edit selected systems`, plus the trailer.

---

### Task 3.10: Saved views

**Files:**
- Modify: `src/db/schema/projects.ts`: add the table `savedView`
- Generate: `npm run db:generate -- --name saved-views`
- Create: `src/lib/ops/saved-views.ts`, `src/lib/ops/saved-views.test.ts`
- Create: `src/server/trpc/routers/views.ts` and register it as `views` in `src/server/trpc/router.ts`
- Create: `src/components/save-view-button.tsx`
- Modify: the board (`board-view.tsx`), systems (`systems-toolbar.tsx`) and activity (`activity-view.tsx`) toolbars: add a "Save view" button, shown when the query has filters
- Modify: `src/components/shell/app-sidebar.tsx` and `src/components/shell/shells.tsx`: add a "Views" group

**Interfaces:**
- Table `saved_view`:

  | Column | Type |
  | --- | --- |
  | `id` | text pk, `newId()` |
  | `user_id` | text, not null, FK `user.id` on delete cascade |
  | `project_id` | text, nullable, FK `project.id` on delete cascade |
  | `name` | text, not null |
  | `path` | text, not null |
  | `query` | text, not null, default `''` |
  | `pinned` | boolean, not null, default true |
  | `sort_order` | integer, not null |
  | `created_at` | timestamptz, default now |

  Index on `(user_id, sort_order)`.
- In `src/lib/ops/saved-views.ts`:
  - `savedViewInput = z.object({ name: z.string().trim().min(1).max(60), path: z.string().max(300), query: z.string().max(1000).default("") })`.
  - `SAVED_VIEW_LIMIT = 30`.
  - `ALLOWED_VIEW_PATH = /^\/p\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(boards\/[a-z0-9-]+|systems|activity|questions|adrs|roadmap)$/`, plus the exact paths `/` and `/workload`.
  - `createSavedView(db, actor, raw): Promise<SavedViewRow>`:
    - checks the path against the pattern, else throws `InvalidError("Views can be saved for boards, systems, activity, questions, decisions, the roadmap and workload.")`;
    - for `/p/<slug>/…`, checks viewer access to the project through `projectAccess` (404 when invisible) and stores its `project_id`;
    - strips a leading `?` from `query`;
    - above the limit, throws `ConflictError("You can keep up to 30 views. Delete one first.")`;
    - `sort_order` is the actor's max plus one, under a row lock on the actor's `user` row.
  - `listSavedViews(db, actor, opts: { projectId?: string }): Promise<SavedViewRow[]>`: the actor's views, restricted to projects where the actor is still an active member (or null-project views), in `sort_order`. With `projectId`, it returns views of that project plus global ones. Archived projects' views are left out (Part 2).
  - `renameSavedView(db, actor, id, name)`, `deleteSavedView(db, actor, id)`, `reorderSavedViews(db, actor, orderedIds: string[])`, `setSavedViewPinned(db, actor, id, pinned)`. Each acts on the actor's own views only; another user's id gives 404.
- tRPC `views`: `list({ project?: string })`, `create`, `rename`, `delete`, `reorder`, `setPinned`.
- UI:
  - `SaveViewButton({ path, query })` opens a small dialog with a name input (default suggestion: e.g. `"Board · Owner: Ammo"`, built from the active chip labels) and saves.
  - The sidebar shows a "Views" group, pinned views only, under the project's sections (the project's views plus global ones) or on global pages (global ones only). Each links to `path + (query ? "?" + query : "")`.
  - Each entry has a hover menu with Rename, Unpin and Delete.
  - A "Manage views" page is not needed; the menus cover it.

- [ ] **Step 1: Write failing PGlite tests.**
  - Create a view for `/p/demo/boards/development` with query `lane=owner`. `listSavedViews` returns it with `projectId` set.
  - The path `/p/demo/settings`: 400.
  - A project the actor is not in: 404.
  - A 31st view: 409 with the exact message.
  - Another user renaming it: 404.
  - After the actor is removed from the project, `listSavedViews` omits the view; after re-adding, it is back.
  - `reorderSavedViews` with a missing id: 400.
  - No `change_log` rows are written.
- [ ] **Step 2: Run the tests, see them fail, implement, and see them pass.**
- [ ] **Step 3: Add the router, the sidebar group and the button. Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 4: Commit** `feat(views): save and pin filtered views in the sidebar`, plus the trailer.

---

### Task 3.11: Choose overview panels (and the prefs router)

**Files:**
- Create: `src/lib/pref-keys.ts`, `src/lib/pref-keys.test.ts`
- Modify: `src/server/trpc/routers/prefs.ts` (created by Part 1 Task 4 as `prefsRouter`): validate `set` values against `PREF_SCHEMAS`; do not create a second router.
- Create: `src/lib/overview-panels.ts`, `src/lib/overview-panels.test.ts`
- Create: `src/components/overview/customize-dialog.tsx`
- Modify: `src/app/(app)/p/[project]/overview-view.tsx`: render the panels from the resolved order
- Modify: `src/components/board-view.tsx`: move column and lane collapse state to the `board.collapsed.<boardId>` pref

**Interfaces:**
- `src/lib/pref-keys.ts`:
  - `PREF_SCHEMAS`, a record from key pattern to zod schema:
    - `"overview.panels"`: `z.object({ order: z.array(z.string()).max(20), hidden: z.array(z.string()).max(20) })`;
    - `"board.collapsed"`, matched as a prefix for `board.collapsed.<boardId>`: `z.object({ columns: z.array(z.string()).max(50), lanes: z.array(z.string()).max(100) })`;
    - `"mywork.seenAt"`: `z.string().datetime()`.
  - `prefSchema(key: string): z.ZodType | null`: matches an exact key first, then the longest prefix followed by a dot. Parts 6 (`notify.rules`) and 9 (`locale`) add their keys here.
- Router `prefs`:
  - `get({ key })` returns the stored value or `null`;
  - `set({ key, value })` validates with `prefSchema(key)` (an unknown key gives BAD_REQUEST "Unknown preference.") and calls `setPref(db, actor.userId, key, value)` from Part 1;
  - no change log.
- `src/lib/overview-panels.ts`:
  - `OVERVIEW_PANELS = ["status", "attention", "phases", "updates"] as const` (the four sections of `overview-view.tsx` today: "Systems by status", "Needs attention", "Phases", "Latest updates");
  - `type PanelId = (typeof OVERVIEW_PANELS)[number]`;
  - `resolvePanels(pref: unknown): { id: PanelId; visible: boolean }[]`. Invalid prefs fall back to the default order, all visible. Unknown ids are dropped. Panels missing from `order` are appended at the end in default order, visible, so a panel added in a future part shows up.
- UI:
  - A "Customize" button in the overview header opens `customize-dialog.tsx`: rows with a switch (visible) and up and down buttons.
  - Saving calls `prefs.set("overview.panels", …)`.
  - The layout stays the same two-column grid: panels fill the left column first in order, "status" is always full width when visible, and the rest alternate as today.

- [ ] **Step 1: Write failing tests.**
  - `resolvePanels(null)` gives the default order, all visible.
  - `resolvePanels({ order: ["updates", "bogus", "status"], hidden: ["status"] })` gives `updates` (visible), then `status` (hidden), then `attention` and `phases` appended (visible).
  - `prefSchema("board.collapsed.abc")` returns the collapsed schema; `prefSchema("nope")` returns `null`.
- [ ] **Step 2: Run the tests, see them fail, implement, and see them pass.**
- [ ] **Step 3: Add the router and the dialog, and render the overview from `resolvePanels`.**
- [ ] **Step 4: Switch board column and lane collapse to the pref.** Read it on the page with the prefetch; write it on toggle with an optimistic update. This finishes Task 3.3 Step 5.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npx vitest run`.
- [ ] **Step 6: Commit** `feat(overview): let each person choose and order overview panels`, plus the trailer.

---

### Task 3.12: Keyboard shortcuts

**Files:**
- Create: `src/lib/shortcuts.ts`, `src/lib/shortcuts.test.ts`
- Create: `src/components/shell/use-shortcuts.ts`
- Create: `src/components/shell/shortcuts-dialog.tsx`
- Modify: `src/components/shell/app-shell.tsx`: mount `useShortcuts` and the dialog
- Modify: `src/components/shell/command-menu.tsx`: add a "Keyboard shortcuts" group that opens the dialog, and show each section's shortcut with `<Kbd>` (`@/components/ui/kbd`)
- Modify: `src/components/new-system-dialog.tsx`: open on the `roadmap:new-system` window event
- Modify: list rows that j and k move between: add `data-nav-item` and `tabIndex={0}` to systems table rows, activity timeline rows, question cards, ADR list rows and My work rows (board cards already got it in 3.2)

**Interfaces:**
- `src/lib/shortcuts.ts`:
  - `interface Shortcut { keys: string[]; label: string; action: ShortcutAction }`, where `keys` holds single keys or two-key sequences, such as `["g", "b"]`.
  - `type ShortcutAction = { go: "overview" | "boards" | "systems" | "activity" | "questions" | "adrs" | "roadmap" | "home" } | { event: "new-system" | "search" | "help" } | { focus: "next" | "prev" }`.
  - `SHORTCUTS: Shortcut[]`:

    | Keys | Label | Action |
    | --- | --- | --- |
    | `g h` | Go home | `go: home` |
    | `g o` | Go to overview | `go: overview` |
    | `g b` | Go to boards | `go: boards` (the first board, `/p/<slug>/boards/<first board slug>`) |
    | `g s` | Go to systems | `go: systems` |
    | `g a` | Go to activity | `go: activity` |
    | `g q` | Go to questions | `go: questions` |
    | `g d` | Go to decisions | `go: adrs` |
    | `g r` | Go to roadmap | `go: roadmap` |
    | `c` | New system | `event: new-system` |
    | `/` | Search | `event: search` (opens the command menu) |
    | `j` | Next item | `focus: next` |
    | `k` | Previous item | `focus: prev` |
    | `?` | Show shortcuts | `event: help` |

  - `isTypingTarget(el: { tagName: string; isContentEditable?: boolean; closest?: (s: string) => unknown } | null): boolean`. True for INPUT, TEXTAREA, SELECT, `isContentEditable`, or anything inside `[cmdk-root]`, `[role="dialog"]` or `[role="menu"]`.
  - `class ShortcutMatcher { constructor(shortcuts: Shortcut[], sequenceTimeoutMs = 1000); press(key: string, now: number): ShortcutAction | null }`:
    - a sequence prefix (`g`) returns null and waits;
    - the second key within the timeout returns the action;
    - after the timeout, or on an unknown key, the state resets;
    - single-key shortcuts match immediately unless a sequence is pending;
    - keys are compared case-sensitively after mapping `event.key` (`?` stays `?`).
- `useShortcuts({ projectSlug, firstBoardSlug })`:
  - a `keydown` listener on `window`;
  - skips events with `ctrlKey`, `metaKey` or `altKey`, and skips when `isTypingTarget(document.activeElement)`;
  - `go` actions without a project (on global pages) work only for `home`;
  - `focus` moves among `document.querySelectorAll("[data-nav-item]")` in DOM order, wrapping around, focuses and `scrollIntoView({ block: "nearest" })`;
  - `c` dispatches `roadmap:new-system` only on project pages when the actor can edit (pass `canEdit`);
  - `/` calls `openCommandMenu()`;
  - `?` opens `ShortcutsDialog`.
- `ShortcutsDialog`: a shadcn `Dialog` titled "Keyboard shortcuts", listing `SHORTCUTS` grouped as Navigation, Actions and Lists, plus "Alt+← / Alt+→ Move the focused card" from Task 3.2 and "⌘K / Ctrl+K Search".

- [ ] **Step 1: Write failing tests in `shortcuts.test.ts`.**
  - `press("g", 0)` returns null; `press("b", 500)` returns `{ go: "boards" }`.
  - `press("g", 0)` then `press("b", 1500)` returns null, because of the timeout, and resets.
  - `press("c", 0)` returns `{ event: "new-system" }`.
  - `press("x", 0)` returns null.
  - `press("g", 0)` then `press("x", 100)` returns null, and then `press("c", 200)` returns the new-system action, because the state reset.
  - `isTypingTarget({ tagName: "INPUT" })` is true; `{ tagName: "DIV", isContentEditable: true }` is true; `{ tagName: "BUTTON" }` is false; a div whose `closest("[cmdk-root]")` returns an object is true; `null` is false.
- [ ] **Step 2: Run the tests and see them fail. Implement `shortcuts.ts`. Run them and see them pass.**
- [ ] **Step 3: Implement the hook and the dialog, wire them into `AppShell`, the command menu and the new-system dialog, and add `data-nav-item` to the list rows named above.**
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npx vitest run && npm run build`. All green.
- [ ] **Step 5: Check by hand.**
  - On a project page press `g` then `s`: Systems opens.
  - `j` / `k` move focus between rows, and Enter opens a row.
  - Typing "gs" in the board search box does not navigate.
  - `?` shows the dialog.
  - `c` opens New system for an editor and does nothing for a viewer.
- [ ] **Step 6: Commit** `feat(ui): add global keyboard shortcuts`, plus the trailer.

---

## Part completion

- [ ] Run the full check: `npm run lint && npm run typecheck && npm test && npm run test:plugin && npm run build`. All green.
- [ ] Update `README.md` → "Agents: MCP and REST": list the new tool `my_work` next to the others. Commit `docs(readme): list the my_work tool`, plus the trailer.
