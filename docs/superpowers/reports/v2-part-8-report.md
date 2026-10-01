# Part 8 (insight and reporting): report

Branch `feat/v2`, Part 8 commits:
- 49e083c, 8e2ce74, debefd0, b565bfc, cc889f6, a2907e3, 4b1845e, 784e9b0, 7cf89a6, 8a6e8af, 6a838d5, a620b9d, 2d4e28b, 18c5ed7, e4b7e86
- a02ff1c (was d20c267 before the Part 9 autosquash), the final-review fix commit

The Part 7 fix commit c359363 sits among them because the parts overlapped. Gate green before the fix commit: lint, typecheck, 1216 tests, 38 plugin tests, 14 Valkey integration tests, build (which confirms the dagre graph library works in the browser bundle) and build:worker. After the fix commit, 1283 tests pass. The only failure was a Part 9 test file that was being repaired at the time. Migration 0028. New dependency: `@dagrejs/dagre`.

## Tasks done
All 15 tasks are done and each passed review:
1. Chart scale and day tick helpers
2. Burn-up replay and finish projection
3. Progress op, `insight.progress` and the `get_progress` tool
4. Time in column category
5. Burn-up chart and the roadmap Progress view
6. Release schema and scope ops
7. Readiness, slip risk, shipping and versioned release notes
8. Release procedures, `list_releases` / `get_release` tools and the `/next` preference
9. Release pages, system release property and filters
10. Graph layout and `GraphView`
11. Decision map
12. Phase dependency graph on the roadmap page
13. Activity filters on the server
14. Folding noisy bursts
15. Activity CSV export

The tasks ran in four parallel streams, all on Sonnet. These needed fix rounds:
- **8.13:** progress updates were capped at the newest 100 with no paging. Updates now page with their own cursor, alongside changes.
- **8.9:**
  - An invalid UTF-8 byte broke the Release column placeholder.
  - A stale `?release=` link took down the whole Progress view; it now drops the filter.
  - The "at risk" chip is amber (ruling).

The Opus final review found five important problems, fixed in a02ff1c:
- The REST `get_progress?days=14` call always answered 400.
- A release whose systems had no tasks yet showed "Done / On track". It now reads "No tasks yet / unknown".
- With slow pace, the burn-up chart squashed six weeks of history into a few pixels. The projection is now capped and clipped with a "→ date" label.
- There was no UI to edit or delete a release. Edit and Delete now exist, with the same permissions as the ops.
- The README didn't cover Part 8. It now lists the new tools and has an "Insight and releases" section.

The same commit also fixed these smaller items:
- Activity entries name the release they're about.
- "Moved to release X" appears in the system activity feed.
- "+-3" shows correctly as "-3".
- "Frozen by" comes from one server query.
- The decision map's edge colours are merged properly.
- A circular import between the releases and insight code was removed.
- Shipping and assigning to the same release can no longer deadlock.
- An unknown release filter answers "not found" consistently.
- Release notes take only the first line of a system summary.
- Rarely, the burn-up could lose a task's current state. Fixed.
- "In category for" no longer resets on moves within the same category.

## Deviations from the plan
- **Tool list budget** raised three times by the measured growth: 37888 → 38656 → 38912 → 39680. Each raise has the reason in its commit.
- **`ACTIVITY_GROUPS`** also maps `code` to systems, and `repo`/`webhook` to structure. Those entities came after the plan.
- **Release assignment rules** live in `applySystemPatch`, so bulk edits and the REST/MCP `update_system` enforce frozen and shipped too.
- **Ship-block message** uses the true count ("1 of 3 systems aren't done: …"). The plan's example was inconsistent.
- **Projection** gains a `no-scope` reason. Releases with no systems, or "done" while systems aren't done, read as risk `unknown`.
- **Smaller additions:**
  - `getRelease` returns `gatesTotal` and `frozenBy`.
  - `phaseGraphInput` takes only the phases.
  - Activity paging has a cursor input.
  - Medians count only systems that spent time in a category.

## Decisions I made (rulings)
1. Ruling: the tool budget is raised by the measured growth (rounded up to 256 bytes), with old/new size and reason in the commit body — the plan adds 3 tools while 18 bytes remained — cost if wrong: a larger tool list for agents.
2. Ruling: ACTIVITY_GROUPS maps code → systems, repo/webhook → structure — later parts added entities the plan's table predates — cost if wrong: grouping labels only.
3. Ruling: release assignment rules are enforced in applySystemPatch (bulk + REST/MCP covered) — cost if wrong: none.
4. Ruling: execution in parallel streams on Sonnet; agents stage only their own files — cost if wrong: none (two collisions were caught and repaired).
5. Ruling: the ship-block message uses the true unfinished count — the plan's example was inconsistent — cost if wrong: wording.
6. Ruling: the at-risk chip is amber (cat-review), sharing amber with the frozen status chip because both have text labels — cost if wrong: colour only.

## Parked minor findings
- The releases list fires one `releases.get` per open release, for the risk chip. Release counts are small. Computing risk in `listReleases` would fix it.
- `getProgress` replays the full task log each call. That's acceptable at the expected sizes.
- If a system is assigned during the instant before shipping, shipping doesn't lock that system's row first.
- A client view holding a deleted release's slug shows an error until reload. The page guards the first load.
- Chart labels are small on phones.

## Things you should know
- **Usage limit and collisions.** Part 8 ran while the weekly usage limit forced Sonnet-only work. Two concurrent agents once committed into each other's commits:
  - a Part 9 amend landed on a Part 9 fix
  - one fix commit had broken escapes

  I caught both and repaired them. The implementer rules now forbid `--amend` while other agents work.
- **Trailers.** Every Part 8 commit carries the Opus trailer.

## Manual checks still to do (need sign-in)
- **Releases:**
  - Roadmap → Progress: chart, stat tiles, filters, range, column times, release chip.
  - Releases list and detail: create, assign from the system page, freeze (editors see "Frozen: ask an owner"), edit or delete, ship with an unfinished system, notes editor and versions.
- **Graphs:** Decisions → Map with about 50 ADRs on a phone-width screen; the graph scrolls inside the page. Roadmap → Graph view.
- **Activity:** person, agent and kind filters, "Load older", folded bursts, and Export CSV.
