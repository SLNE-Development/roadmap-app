# Part 0 (review fixes): report

Branch `feat/v2`, commits `0699247..7b54086` (19 task commits plus 1 final-review fix commit). The final gate is green: lint, typecheck, 272 tests, 26 plugin tests and build.

## Tasks done
All 19 tasks (1–19) are done. Each one passed a task review for spec and quality. Four needed a fix round:
- Task 4: the global error page loaded no stylesheet.
- Task 7: an unrelated prettier reflow was reverted before review.
- Task 16: control characters in `next` allowed an open-redirect bypass.
- Task 19: a doc comment was left unchanged.

The final whole-part review (Opus) found one critical regression, which is fixed in 7b54086. Task 2's merged invalidation predicate meant that queries without a project were never refetched after a mutation: the API key list, the admin allowlist and the project cards. The same commit fixes the search-box keystroke race, a spurious "Notes changed elsewhere" warning, and the missing boards → planning invalidation.

## Deviations from the plan
- The error screens use Next 16's `retry` prop, not `reset`.
- The React state sync uses the "adjust state during render" pattern, because the repo lint rule forbids `setState` in effects.
- `listAdrs` with an unknown system slug now returns 404.
- `INVALIDATES.boards` also invalidates `planning`.
- The final-review fixes are a separate commit.
- `safeNextPath` also rejects control characters.
- The systems test asserts `statusOf(error) === 400`, because ops throw a ZodError.

## Decisions I made (rulings)
1. Manual checks that need a Discord sign-in were skipped and are listed below. If this is wrong, UI regressions that only show when signed in go unnoticed until your manual pass.
2. The error screens use `retry`, not `reset`, following the installed Next 16.3 docs. If this is wrong, reverting is a one-word change in 3 files.
3. `listAdrs` returns 404 for an unknown system instead of `[]`, which matches `listQuestions` and `listUpdates`. If this is wrong, a client that expects `[]` gets an error.
4. The state sync uses render-time previous-value state instead of `useEffect` + `setState`, because of the lint rule. If this is wrong, the only cost is a less familiar code shape.
5. The final-review fixes are one follow-up commit rather than rewritten task commits. If this is wrong, Part 0 has 20 commits instead of 19.
6. `planning` was added to `INVALIDATES.boards`. If this is wrong, the cost is one extra refetch.

## Things you should know
- **Your dev database was migrated.** During Task 12's manual check, an implementer ran `runMigrations` against the `.env` database (localhost:5433, container `roadmap-v2-dev-db`). Migration `0002_review-indexes` (21 `CREATE INDEX` statements) is now applied there. A scratch database was also created and then dropped on that server. Later implementers are told to use throwaway containers only.
- Port 5432 is taken by another project's container (`surf-roleplay-dev-postgres-1`), so `docker compose up -d postgres` fails on this machine unless `POSTGRES_PORT` is set.
- Parked minor issue: when two debounced search pushes are in flight at once, the systems search box can briefly reset. It corrects itself, and needs about 250 ms of network lag to happen.

## Manual checks still to do (need sign-in)
- T1: delete a throwaway project from Settings. You should land on `/` in under a second, with no retried `projects.get` calls.
- T2: tick a task. The refetch should include `systems.*` and `history.*`, but not `members.list` or `account.users`. Also: creating or revoking an API key updates the list right away.
- T3: create a first project from the empty state. It should open `/p/<slug>` and show a toast. A hand-edited board slug should stay when you change the name. Cancel should close the dialog.
- T4: `/nope`, `/p/demo/systems/nope` and `/p/nope` show 404 screens. A temporary throw shows the error screen with "Try again". The loading skeleton shows on Slow 4G. The global error page is styled.
- T15: a signed-in `fetch` POST to `/api/auth/api-key/create` returns 404. Creating a key on Settings → API keys works, and the key authenticates `GET /api/v1/projects`.
- T16: open a deep link in a private window and sign in. You should land back on the link.
- T17: Clear filters empties the search box. Adding a task with Enter keeps focus. A column draft survives when another tab moves a system.
- T18: at 390 px, the last activity row sits above the bottom bar. A project with one member reads "1 member".
