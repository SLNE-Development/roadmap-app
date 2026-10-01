# Part 4 (planning and documents): report

Branch `feat/v2`, commits `04773c4..66f35c6`: 10 task commits plus 1 final-review fix commit. Gate green: lint, typecheck, 647 tests, 13 Valkey integration tests, 26 plugin tests, build. Migrations 0016–0020. The search migration also ran on a throwaway Postgres 17.

## Tasks done
All 10 tasks are done and each passed review:
1. Coverage map
2. Reopen one area
3. Heading outline
4. Plan steps with live state
5. Spec/plan diffs
6. Column gates registry and enforcement
7. Gates UI
8. Glossary
9. Project pages
10. Full-text search

Task 6 was committed before Task 5 (ruling).

These needed a fix round:
- Task 3: a malformed URL hash crashed the tab. While fixing it, the image-alt-text heading id mismatch was found and fixed.

Task 10's implementer also caught a real leak. The generated `search` tsvector column showed up in system responses, and it was fixed with `systemColumns`.

The Opus final review found four problems, fixed in 66f35c6:
- Large diffs could block the server for about 40 s. They are now bounded with a timeout, and lines over 2 000 characters skip word-level diffs.
- Search hits had duplicate keys.
- "New page" overwrote an existing page.
- `set_glossary_term` without `aliases` wiped the existing aliases.

The same commit also fixed 15 smaller items: gate accessibility, the planning-column rules invariant, invalidation, bulk tests, the postgres NOTICE log noise, and others.

## Deviations from the plan
- **Diff package.** `diff` ^9 is used instead of 8.x.
- **Card gates field.** Gate status on cards uses Part 3's "gates" card field, which is now in the code default.
- **Move path.** The checks live in `applySystemMove`, so bulk moves are gated too. A no-op move returns before the reopened-area check.
- **Glossary aliases.** If `aliases` is left out of `set_glossary_term`, the existing aliases stay unchanged.
- **New page.** `writePageInput.create` makes the New page dialog refuse an existing slug.
- **Extra pieces:**
  - `boards.list`
  - `searchProjectWithRefs`
  - `columnRulesOf`/`rulesSummary`
  - the "Area X is not reopened." error
  - `pageCount` on ProjectNav
  - `useDebouncedValue` hook
  - `onnotice` in the DB client

## Decisions I made (rulings)
1. Ruling: Part 3's "gates" card field renders from Part 4 Task 7's `gates.board` result (passed to cards) instead of a `SystemListItem.gateStatus` field; Task 7 removes the "(after column gates)" label — one source of gate status — cost if wrong: none.
2. Ruling: the done-column reopen check (Task 2) and rule gates (Task 6) go into `applySystemMove` so `updateSystems` bulk moves enforce them too — Part 3 moved the move body there — cost if wrong: none.
3. Ruling: Task 6 runs before Task 5 (parallel with Task 4) — they are independent and Task 5 shares document-section.tsx with Task 4 — cost if wrong: none (commit order differs from plan numbering)
4. Ruling: card gate status renders through the Part 3 "gates" card field fed by gates.board; "gates" added to DEFAULT_CARD_FIELDS (code default; existing boards keep their stored fields) — one source of gate status — cost if wrong: existing boards need an owner to switch the field on
5. Ruling: diff ^9 installed instead of the plan's 8.x — index says check npm view and pin the current version with ^; API used (diffLines, diffWordsWithSpace, createTwoFilesPatch) unchanged — cost if wrong: pin back to ^8
6. Ruling: set_glossary_term `aliases` omitted means unchanged (plan said default([])) — an agent fixing a definition must not silently lose aliases — cost if wrong: clearing aliases needs an explicit []
7. Ruling: writePageInput gains optional `create` so the New page dialog refuses an existing slug (409); the write_page tool keeps create-or-append — cost if wrong: one extra optional input
8. Ruling: same-column early return moved before the reopened-area done check — the plan's order applies to real moves; a no-op must not fail — cost if wrong: none

## Things you should know
- Two commits had a wrong `Co-Authored-By` trailer: one from an implementer, one from a README helper. I corrected both. Every commit on the branch now carries the Opus trailer.
- Run the search migration (0020) on a copy of production data first. It adds generated columns to five tables, which rewrites them.

## Manual checks still to do (need sign-in)
- 1: planning tab coverage map + Thin chips + Ready to complete line.
- 3: spec/plan outline (sticky at lg, collapsible below), heading # anchors, ?tab=spec#scope scrolls.
- 2: Reopen one area dialog, reopened-area banner, Done move refused while an area is reopened.
- 4: plan tab Steps panel (above doc on mobile, above outline at lg), heading state chips, older-version label, task row anchors.
- 5: Read/Compare toggle, from/to selects, diff view (+/− counts, word marks, No changes), activity 'Compare with vN-1' links.
- 7: Settings → Boards → column Rules dialog; card gate status ('Review 2/3', 'Review ready', tooltip); owner override dialog on refused move.
- 8: Settings → Glossary (add/edit/delete), dotted-underline tooltip terms in spec/plan text.
- 9: Pages list + New page dialog, page view (outline, compare, glossary, version picker), editor with Preview and stale-version conflict, sidebar Pages + command menu pages.
- 10: command menu 'In documents' search group with snippets, Searching… row.
