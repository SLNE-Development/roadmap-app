# Part 3 (boards and UX): report

Branch `feat/v2`, commits `6064ee2..2636636`: 12 task commits, a README commit and 1 final-review fix commit. The gate is green: lint, typecheck, 520 tests, 13 Valkey integration tests, 26 plugin tests and build.

## Tasks done
All of 3.1–3.12 are done and each passed review:
- URL board filters and a shared filter chip
- keyboard and touch card moves
- swimlanes
- per-board card fields
- server-side "Needs attention" with stale alerts
- project health on home cards
- My work inbox and the `my_work` tool
- team workload page
- bulk edit on the systems table
- saved views
- overview panels and pref validation
- keyboard shortcuts

The README lists the v2 tools.

These tasks needed a fix round:
- 3.2: keyboard focus after a refused move was fragile.
- 3.5: a test depended on the real clock, and ages were baked into server-rendered strings instead of staying live on the client.
- 3.8: admins could pick projects they don't belong to in the workload filter, which caused a 404 crash.

The Opus final review found two saved-views problems, fixed in 2636636:
- Unpinned views became unreachable but still counted toward the limit.
- Admins who weren't members could save views that never showed up.

The same commit added privacy tests, `my_work` tool and `prefs.set` router tests, and invalidation and bundle cleanups.

## Deviations from the plan
- The board search keeps Part 0's render-time sync. The plan's `key={q}` remount would have dropped focus.
- The default card fields keep today's card look: domain, priority, blocked, tasks, owner.
- Custom card fields use `custom:<key>`.
- Health reasons use correct singular and plural forms.
- The pref key regex now allows camelCase, so the index's `mywork.seenAt` and `timeZone` are valid.
- Unpinned views live in a "More views" disclosure.
- Saving a project view requires membership.
- Part 1's real `setPref` signature is used.
- Implementers staged only their own files instead of `git add -A`.

## Decisions I made (rulings)
1. Ruling: Task 3.11 uses Part 1's real signatures (`setPref(db, actor, key, value)`, existing `prefsRouter`) where the plan writes `setPref(db, actor.userId, …)` — Part 1 is the source of truth for shared names — cost if wrong: none (same behaviour).
2. Ruling: Task 3.4 custom card fields are `custom:<key>` everywhere (Interfaces + index say key; Step 6's `custom:<id>` is a typo) — cost if wrong: none.
3. Ruling: no task uses `git add -A`; implementers stage only their own files (untracked docs/superpowers/reports must stay out of commits) — cost if wrong: none.
4. Ruling: board search keeps the Part 0 render-time sync (isOwnPush) instead of the plan's key={query.q} remount — remounting on its own debounced push would drop focus and keystrokes, the bug Part 0 fixed — cost if wrong: none visible
5. Ruling: default board card fields include domain and priority (plan listed only owner/tasks/blocked but said "the fields cards show today") — keeps existing boards visually unchanged — cost if wrong: owners can switch them off
6. Ruling: health reasons use plural() with verb agreement instead of the brief's literal "1 systems"/"1 blocking questions" — Part 0 fixed plurals app-wide — cost if wrong: none
7. Ruling: Part 1 PREF_KEY widened to camelCase segments so the index's pref keys (mywork.seenAt, timeZone) are valid — index shared names outrank the Part 1 regex — cost if wrong: none
8. Ruling: unpinned saved views are listed in a collapsed "More views (N)" group with Pin/Rename/Delete (plan said Unpin exists but no manage page) — keeps every view reachable — cost if wrong: one extra sidebar disclosure
9. Ruling: creating a saved view of a project requires active membership (admins who aren't members get InvalidError) — such views could never be listed — cost if wrong: admins must join to save views
10. Ruling: board-view.tsx is not split into components now (reviewer recommendation) — a refactor outside any plan task; Part 4 Task 7 touches cards via system-card.tsx — cost if wrong: Part 4 edits land in an 855-line file

## Things you should know
- `src/components/board-view.tsx` is now about 850 lines after six tasks touched it. The reviewer recommends splitting it into ColumnHeader, layouts and SystemCard. Not done, because no plan task asks for it.
- Several implementers wrote tests and code together, so no RED run was captured. Reviewers confirmed the tests check real behaviour.

## Manual checks still to do (need sign-in)
- 3.1: board Domain filter survives reload, back removes it; chips look the same on Board/Systems/Activity/Questions.
- 3.2: Tab to a card, Alt+→ moves and keeps focus; refused move out of planning snaps back with focus + toast + live region; touch long-press drag in DevTools device mode; desktop mouse drag.
- 3.3: Lanes → Owner rows with counts summing to column totals; lanes survive reload; sticky headers in lane mode.
- 3.4: Board options → Card fields… (owner) dialog, switches + reorder; cards render chosen fields in both layouts.
- 3.5: overview Needs attention shows blocked, blocked-task, stale, planning, decision, question items with live ages.
- 3.6: home project cards show health badge + tooltip reasons; Health sort.
- 3.7: home My work panel (Waiting on you / Since you were last here, Mark all seen), greeting line.
- 3.9: systems table checkboxes + select-all, sticky bulk bar (Owner/Phase/Domain/Priority/Move to), toast, failure message.
- 3.8: /workload table, expand rows with project links, project chip, Overloaded chip.
- 3.10: Save view button (board/systems/activity), sidebar Views group with Rename/Unpin/Delete.
- 3.11: overview Customize dialog (visibility, order), board column/lane collapse persists per board.
- 3.12: g s / g b etc. navigate; j/k move focus; typing 'gs' in a search box doesn't navigate; ? opens dialog; c opens New system for editors only.
