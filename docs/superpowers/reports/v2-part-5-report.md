# Part 5 (agents): report

Branch `feat/v2`, commits `ad2a540..af56193`: 13 task commits, 1 README commit and 1 final-review fix commit. Gate green at `af56193`: lint, typecheck, 743 tests, 38 plugin tests, 13 Valkey integration tests, build. Migrations 0021–0023.

## Tasks done
All 13 tasks are done and each passed review:
1. Batch tools (`add_tasks`, `update_tasks`, `answer_questions`) with idempotent `clientRef`
2. Brief responses by default
3. Tool list budget: 47 586 → 37 870 bytes (limit 37 888)
4. OpenAPI document `/api/v1/openapi.json` and `/api/docs`
5. Agent runs and calls (`agent_run`, `agent_call`, `recordCall`, `bearerAuth`), REST-only `start_agent_run` / `report_agent_usage`
6. Plugin hooks: name a run at session start, report token usage on stop (plugin 1.1.0)
7. Agents page with run timelines and cost per system
8. Project brief MCP resource and the `next`, `status`, `plan` prompts
9. AGENTS.md and Cursor rules generated from the conventions
10. API key usage and rotation with a 24 h grace period
11. Signed-in sessions page with sign-out of other devices
12. Auth events and the admin audit view (`/admin/audit`)
13. Retention job: agent telemetry 30 days, auth events 90 days

Order: Task 9 ran alongside Task 5, and Task 13 before Tasks 11–12 (rulings). Auth-event pruning landed with Task 12, once the table existed.

These needed a fix round:
- Task 6: the transcript is now streamed, with time limits so a hook never hangs Claude Code.
- Task 7: call and error counts per project; token totals are labelled "run total".
- Task 13: the nightly cron was not pinned to UTC. `registerRepeatable` now accepts an optional `tz`.
- Task 10: the server refused nothing when a key already in its grace period was rotated again. It now answers 409.

The Opus final review found two important problems, fixed in af56193:
- **Session runs split.** A Claude Code session that went more than 10 minutes without a roadmap call started a new, untitled run. Token totals stayed on the first run and could disappear from the Agents page. Usage reports now keep the session's run current, and runs started by the plugin group calls with a 60-minute gap.
- **Unauthenticated writes.** Each new bogus API key wrote one `auth_event` row. Now at most 5 per IP per minute are written, with an atomic throttle.

The same commit fixed these smaller items:
- batch validation errors now say "Item 3: …" (1-based)
- `whoami` is no longer recorded, so a session start no longer leaves an empty extra run
- long repo or branch names are cut so the run title passes validation
- account mutations refresh the admin audit view
- a registry test now rejects two tools with the same method and path
- an MCP test checks that a failing recorder doesn't change the tool result
- the plugin's header fallback sentence is fixed
- `endSession` now refuses to end your current session

## Deviations from the plan
- **Run grouping gap.** The plan groups an API key's calls into its latest run while it is less than 10 minutes old. Runs started by the plugin (they have a session id) now use 60 minutes, and the Stop hook's usage report keeps them current. Runs without a session id keep 10 minutes, and "live" stays at 2 minutes.
- **Schedule timezone.** `Schedule` in `src/worker/jobs.ts` gained an optional `tz`, so crons can be pinned to UTC as the plan requires.
- **Key rotation.** Rotating a key that is still in its grace period answers 409. API key metadata is written directly to the row, because the plugin's `enableMetadata` is off.
- **Session-ended events.** Better Auth's `session.delete.after` hook records sign-outs. The sessions page deletes rows directly, so its tRPC procedures record the event themselves (never twice).
- **Batch numbering.** `ToolDef.items` (opt-in) tells `runTool` which input array gets "Item n:" numbering, so `answer_planning_items` is not treated as a batch.
- **Per-IP cap.** On top of the plan's per-key throttle for rejected keys, at most 5 rows per IP per minute are written.

## Decisions I made (rulings)
1. Ruling: Task 8's project brief includes a short `## Glossary` section from Part 4's `glossaryBrief` (index: "glossaryBrief … for Part 5's project brief resource"), within the 4 000-character cap (cut first) — cost if wrong: a few lines in the brief.
2. Ruling: Task 1 updates README's REST example for `POST …/tasks` (`{ tasks: [...] }`) in the same commit, per the index REST-change rule — cost if wrong: none.
3. Ruling: updateTasks keeps locking systems from the initial unlocked read (no re-verify loop) — taskAccess re-checks under lock so correctness holds; a moved task can only cause a detected deadlock → rollback — cost if wrong: rare 500 instead of a clean retry error.
4. Ruling: Task 9 (plugin-only) runs in parallel with Task 5 and before Tasks 6–8; it only names the `plan` MCP prompt that Task 8 adds — cost if wrong: header text referenced a prompt a few commits early.
5. Ruling: per-project call/error counts and the failed filter come from agent_call in that project; token totals stay run-wide but are labelled "run total" — a run spans projects, tokens can't be split exactly — cost if wrong: token numbers on a project page include other projects' work (labelled).
6. Ruling: Task 13 runs before Tasks 11–12; Task 12 adds the auth_event prune when it creates the table — cost if wrong: commit order differs.
7. Ruling: the "re-rotate during grace" minor was fixed rather than parked — a second rotation orphans the first new key and can shrink its lifetime below Better Auth's minimum — cost if wrong: one extra error path.
8. Ruling: INVALIDATES needs no change for account.rotateApiKey — the map is per router and account already invalidates "account" — cost if wrong: none (the final wave added "admin").
9. Ruling: the final fix wave also fixed the review's minor items 3–8 (cheap, visible behaviour); the rest stay parked (below) — cost if wrong: small residual gaps.
10. Ruling: session runs get a 60-minute grouping gap and recordUsage bumps lastCallAt — the plan's 10-minute rule split ordinary Claude Code sessions and lost token totals — cost if wrong: two sessions on one key within an hour group together (already a declared plan limit).

## Parked minor findings
- Two keys of one user racing on a new `clientSessionId` can hit a unique violation (500). Rare, because a session uses one key.
- MCP inputs rejected by the SDK before the handler are not recorded.
- `create()` of a rotated key runs outside the metadata transaction. If that transaction fails, an unused orphan key remains, never shown to anyone.
- `bearerAuth` waits for audit recording on 401/429. This is bounded by the 1 s Valkey command timeout.
- Audit IPs come from the first `x-forwarded-for` hop, so they are only as trustworthy as the reverse proxy.
- No tests for the Better Auth hook wiring, the session-token absence, or the API key UI.
- The tool list sits 18 bytes under its budget. Part 7 adds tools and will have to raise `TOOL_LIST_BUDGET_BYTES` on purpose.
- Better Auth deletes expired keys, so after the grace period a new key's `rotatedFrom` points to a deleted row. The UI doesn't show it.

## Things you should know
- Commit trailers: every Part 5 commit carries the Opus trailer.
- I wrote the README line on `brief` backwards. The final review caught it, and it was fixed in the README commit.

## Manual checks still to do (need sign-in)
- 7: Agents page, run sheet and sidebar entry with seeded runs (two API-key REST calls).
- 10: API keys page: spark bars, "Last used", 30-day line, Rotate dialog, "expires in N h", Revoke now; one real rotation through Better Auth (`createApiKey` with `expiresIn`).
- 11: `/settings/sessions`: table, "This device", Sign out per row, Sign out all other devices.
- 12: `/admin/audit` as admin (three tabs, Load more) and as non-admin (404); sign in/out and watch events appear.
- 6: a real Claude Code session with the plugin: run titled at start, token totals on stop.
- `/api/docs` and `/api/v1/openapi.json` need no sign-in. The build lists both and the tests cover the document, but I didn't fetch them from a running server.
