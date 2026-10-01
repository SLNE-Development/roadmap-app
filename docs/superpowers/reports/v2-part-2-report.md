# Part 2 (work data): report

Branch `feat/v2`, commits `7d828ff..25a4752`: 10 task commits plus 1 final-review fix commit. Gate green: lint, typecheck, 406 tests, 26 plugin tests, build. Migrations 0005–0013 were added. 0011 is a hand-written custom `pg_trgm` migration, which the index allows; it was also checked against a real Postgres 17 container.

## Tasks done
All 10 tasks are done and each passed review:
1. Task notes and required blocked reasons.
2. Estimates and rollups.
3. Checklists.
4. Reorder tasks and move them between systems.
5. Dependencies with cycle checks.
6. Custom fields.
7. Archive.
8. Similar-system warning.
9. Question priority (blocking questions hold the planning gate).
10. ADR history and ADR–task links.

These needed a fix round:
- Task 2: invalidation gaps, an ops-layer violation, and a client bundle that imported server SQL.
- Task 3: `done` semantics in `set_task_checks`.
- Task 6: impossible dates such as 2026-13-45 caused a 500.
- Task 7: new ADR links to archived systems, a missing test, and an unclear message for columns holding only archived systems.
- Task 8: a tool description that ran to three sentences.

The Opus final review found two issues. With every system archived, archived systems could no longer be reached in the UI. Question changes did not refresh the planning panel. Both are fixed in 25a4752, together with:
- the rollups SQL now qualifies its column;
- field ops now take locks in a consistent order;
- archived systems' "Blocking" overview items are removed;
- archived rows are now marked;
- member changes now work on archived projects.

## Deviations from the plan
- `set_task_checks`: `done` is optional, so matched items keep their state. The plan wrote `default(false)`, which contradicted its own tool description.
- Archived systems:
  - New ADR→system and ADR→task links to an archived system are refused.
  - Answering, resolving and prioritising questions on archived systems stays allowed.
  - Naming an archived system as a dependency target stays allowed.
- `listAdrs` and other plan details follow the plan literally. ADR history shows the oldest 100 entries.
- Extras that support the plan:
  - `phaseRollups` ops function.
  - Pure `src/lib/rollup.ts`.
  - `adrs.setTasks` mutation.
  - `INVALIDATES` entries for every new query.
  - `taskAccess` exported.
- Owners can change members of an archived project.

## Decisions I made (rulings)
1. Ruling: set_task_checks item `done` is optional (plan text said default(false)) so matched items keep their state when omitted — the tool description states that intent — cost if wrong: agents must pass done:false to clear a matched item
2. Ruling: for fix diffs under ~15 lines the controller re-reviews by reading the diff itself instead of dispatching a re-review subagent — saves a subagent turn per trivial fix — cost if wrong: subtle breakage in a tiny fix could slip to the part's final review
3. Ruling: answering/resolving questions linked to an archived system and naming an archived system as a dependency target stay allowed; new ADR links to an archived system are refused — the archived system's own rows aren't written by the former, while a new ADR link changes what its page shows — cost if wrong: an archived system can still gain question answers / dependents
4. Ruling: listUsers passes allowArchived (owner-level read) and setSystemArchived is refused inside an archived project — both implementer decisions accepted — cost if wrong: owners must restore the project before archiving systems in it
5. Ruling: task links to tasks of an archived system follow the ADR-system rule (new link refused, existing kept) — consistency with Task 7 — cost if wrong: one extra 409 path
6. Ruling: owners can change/remove members of an archived project (allowArchived on setMember/removeMember) — revoking access must not require restoring — cost if wrong: archived projects aren't fully read-only for membership
7. Ruling: setQuestionPriority on an archived system's question stays allowed (same logic as answer/resolve; the gate ignores archived systems) — cost if wrong: one more allowed write path

## Things you should know
- The dependency cycle check (a recursive CTE) and all ops tests run on PGlite. Only the pg_trgm migration was checked on real Postgres.
- The dependency CTE walks every path. That is fine at the current limit of 20 dependencies per system, but would get slow on very dense graphs.

## Manual checks still to do (need sign-in)
- T1: Blocked… dialog (required reason, prefill), blocked reason under title, Notes dialog + StickyNote button (read-only for viewers), "N blocked" chip on system cards, overview blocked attention items.
- T2: Estimate submenu + chip, Tasks header 'X / Y pts' and 'N unestimated', roadmap phase header pts.
- T3: checklist counter, expand list, checkbox toggle, Add item keeps focus, remove item, Add checklist menu.
- T4: drag reorder (rollback on error), Move up/down menu, Move to system dialog + toast.
- T5: Blocked by N chip, Depends on / Needed by rows, dependency picker with cycle toast.
- T6: Settings → Fields (create/edit/reorder/delete), properties field editors, systems table field columns.
- T7: home Archived toggle + Restore, settings Archive project, archived project banner, system Archive/Restore + banner + disabled edits, systems Archived filter, command menu excludes archived.
- T8: New system dialog shows 'Similar:' links (archived marked) after 300 ms debounce.
- T9: question priority chip + dropdown, ask dialog priority select, overview 'Blocking:' items first.
- T10: ADR Tasks panel, History timeline, Link tasks popover, ADR chips on task rows.
