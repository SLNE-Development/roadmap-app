# roadmap-app v2 Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects found in the 2026-09-30 review, then add the selected v2 improvements and features: better boards and task tracking, planning and document tools, cheaper and more observable agent workflows, notifications (in-app, Discord, Web Push), a GitHub App, reporting, live updates and a German interface.

**Architecture:** The app stays one Next.js service whose business logic lives in the ops layer (`src/lib/ops/*`). v2 adds Valkey and a BullMQ worker process built from the same image. The worker tails `change_log` (the change feed) and fans each new entry out to consumers: live updates, notifications and integrations. Web routes only enqueue work; they never call Discord, GitHub or push services inline.

**Tech Stack:** as in `2026-09-29-roadmap-app-00-index.md`, plus Valkey 8 (`valkey/valkey:8-alpine`), `ioredis` 5, `bullmq` 5, `esbuild` (worker bundle), `web-push` 3, `@octokit/app` + `@octokit/webhooks` (GitHub App), `diff` 8 (document diffs), `@dagrejs/dagre` (graph layout), `next-intl` 4 (German UI). Check each version with `npm view <pkg> version` when installing and pin with `^`.

**Spec:** none for v2 (the user asked for plans only). The source of truth is this index, the part plans, the 2026-09-29 spec (`docs/superpowers/specs/2026-09-29-roadmap-app-design.md`) for everything v2 does not change, and the review findings reproduced in Part 0.

**Plan style:** these plans give exact directions for the executor rather than finished code: which files to touch, exact names and signatures, table columns, behaviour and test cases as concrete input and expected result. Where a plan names a function, type, table, column, tool, route or env var, use exactly that name. Code snippets appear only where prose would be ambiguous.

## Parts

Execute in order. Each part ends with `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:plugin` and `npm run build` green, and one commit per task.

| Part | File | Delivers | Depends on |
| --- | --- | --- | --- |
| 0 | `2026-10-01-roadmap-v2-00-fixes.md` | Every review finding: retry policy and scoped invalidation, first-project navigation, error, not-found and loading screens, reorder bug, indexes migration, lock order, id validation, owner checks, `get_document` null, advisory locks, UI polish, dead code. (Unifying the filter chips is Part 3.) | none |
| 1 | `2026-10-01-roadmap-v2-01-platform.md` | Valkey, BullMQ queues, worker process, change feed, event bus, `user_pref`, Docker/compose/CI changes, `/api/metrics` | 0 |
| 2 | `2026-10-01-roadmap-v2-02-work-data.md` | Task notes, blocked reason, checklists, estimates and rollups, task reorder and move, system dependencies, custom fields, archive, duplicate warning, question priority, ADR history and task links | 1 |
| 3 | `2026-10-01-roadmap-v2-03-boards-ux.md` | Card moves by keyboard and touch, swimlanes, card fields, board filters in URL with one filter-chip component, saved views, bulk edit, keyboard shortcuts, overview panels, My work, team workload, stale alerts, project health | 2 |
| 4 | `2026-10-01-roadmap-v2-04-planning-docs.md` | Coverage map, reopen one area, document outline, plan steps with task state, spec and plan diffs, column gates, glossary, project pages, search inside documents | 2 |
| 5 | `2026-10-01-roadmap-v2-05-agents.md` | Batch tools, brief responses, smaller tool list, OpenAPI and `/api/docs`, MCP resource and prompts, agent runs, agent cost hook, rules for other agents, API key usage, your sessions, admin audit view | 1, 2 |
| 6 | `2026-10-01-roadmap-v2-06-notifications.md` | Notification model and center, @mentions, Discord project webhooks, Web Push (service worker, devices, personal rules, quiet hours) | 1, 3 |
| 7 | `2026-10-01-roadmap-v2-07-github.md` | GitHub App (admin create/install page, installations, health), repo picker with manual webhook fallback, code links, merge rules, PR gate rules | 1, 4, 5, 6 |
| 8 | `2026-10-01-roadmap-v2-08-insight.md` | Progress chart, releases with release notes, decision map, phase dependency graph, activity folding, filters and CSV | 2, 4 |
| 9 | `2026-10-01-roadmap-v2-09-realtime-i18n.md` | Live boards over SSE, presence, German interface | 1, and last because i18n touches every screen |

Parts 3 and 4 may run in either order. Part 7 needs Part 4 (gate rule registry), Part 5 (`brief` on `get_system`) and Part 6 (notification kinds, crypto helper).

## Global Constraints

Everything in the Global Constraints of `2026-09-29-roadmap-app-00-index.md` still holds, except where changed below.

- **Commits:** Conventional Commits in English, `type(scope): lowercase description`, e.g. `feat(boards): add swimlanes`. This overrides the "capitalised subject" rule of the v1 index. End every commit message with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. One task, one commit. Never push.
- **Ops layer rule:** new business logic goes in `src/lib/ops/<area>.ts`, taking `(db: Db, actor: Actor, …)` and a zod input exported as `<name>Input`. Every write runs in one `db.transaction`, checks access with `projectAccess` / `projectAccessById` from `src/lib/ops/access.ts`, and records each changed field with `logChange(tx, actor, entry)` from `src/lib/ops/log.ts`. Throw `InvalidError` (400), `ForbiddenError` (403), `NotFoundError` (404) or `ConflictError` (409) from `src/lib/ops/errors.ts`.
- **Adapters:** the web UI calls tRPC procedures in `src/server/trpc/routers/<area>.ts`, registered in `src/server/trpc/router.ts`. Agents call tools declared with `defineTool` + `register` in `src/lib/tools/definitions.ts`, which serves both MCP and REST. A feature available to agents gets a tool; a feature only for people gets only a procedure.
- **Change log vocabulary:** `entity` is one of the existing names (`project`, `board`, `column`, `domain`, `phase`, `system`, `task`, `document`, `adr`, `question`, `update`, `member`, `planning`) or one added by v2: `check`, `dependency`, `field` (Part 2), `rule`, `glossary`, `page` (Part 4), `webhook` (Part 6), `repo`, `code` (Part 7), `release` (Part 8). A task moved between systems is logged as `task` / `moved` with the source and target system slugs, once on each system. `field` is the column name in camelCase, or `created` / `deleted` / `moved` / `position` for lifecycle entries. Consumers of the change feed rely on these names.
- **Migrations:** each part that changes the schema edits `src/db/schema/*.ts`, then runs `npm run db:generate -- --name <part-topic>` once per task that changes the schema. Never hand-edit generated SQL, except to add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` (Part 2) or generated `tsvector` columns and GIN indexes that drizzle-kit cannot express (Part 4). Such hand additions go in a separate custom migration created with `npx drizzle-kit generate --custom --name <topic>`.
- **Tests:** vitest against PGlite via `createTestDb()` (`src/test/db.ts`) and fixtures in `src/test/fixtures.ts`. Tests never need Valkey: code that touches queues, pub/sub or Valkey keys takes its dependency as a parameter, and tests pass the in-memory implementations from Part 1 (`memoryQueue()`, `memoryBus()`, `memoryKv()`). Real-Valkey tests live in `*.integration.test.ts`, run by `npm run test:integration` in CI with a Valkey service container, and are excluded from `npm test`.
- **UI:** shadcn/ui components from `@/components/ui/*` plus Tailwind utilities, in the Tide tokens of `src/app/globals.css` (square corners, category colours `cat-*`). Add missing shadcn components with `npx shadcn@latest add <name>` and never edit files in `src/components/ui/` by hand. Every interactive control is reachable by keyboard and has an accessible name. UI copy is English literals until Part 9 moves it into message files.
- **Permissions:** viewers read; editors change content; owners manage members, boards, columns, rules, integrations and project settings; admins manage accounts and the GitHub App. A project the actor cannot see is 404, too low a role is 403.
- **Env vars added by v2:** `VALKEY_URL` (required), `METRICS_TOKEN` (optional; without it `/api/metrics` answers 404), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (optional as a set; without them push is hidden), `ENCRYPTION_KEY` (required from Part 6; 32 random bytes in base64, used to encrypt webhook URLs and GitHub credentials). Each is added to `.env.example`, both compose files, the README table and, when required, the `REQUIRED` list in `src/instrumentation.ts` and the worker's own start check.
- **Background work:** anything slower than a database write or talking to another service (Discord, push services, GitHub, repeatable scans) runs as a BullMQ job in the worker, never inline in a request. Jobs are idempotent: they are keyed by `change_log.id` or another natural key, and a retry never double-sends.
- **Scoped invalidation:** Part 0 adds `INVALIDATES` in `src/trpc/invalidation.ts`, mapping each mutation router to the query routers it can affect. Every part that adds a tRPC router adds its entry there; a router without an entry falls back to invalidating everything.
- **Telemetry stays out of the change log:** `agent_run`, `agent_call`, `auth_event`, `feed_seen`, `github_delivery` and notification delivery state are never written to `change_log`.
- **Agent-facing text stays English:** tool descriptions, op error messages (including `gateMessage` and planning errors) and MCP prompts are not translated in Part 9.
- **REST change:** Part 5 replaces `add_task` with `add_tasks` on the same path, so `POST .../tasks` takes `{ tasks: [...] }`. The plugin and README change in the same task.
- **Roadmap references in GitHub:** `roadmap#<taskId>` and `roadmap:<system-slug>`. A bare `#188` is not a roadmap reference, because GitHub already uses it for issues and PRs.
- **Agent token budget:** new tools and changed tool descriptions stay short, one or two sentences. Responses leave out long bodies unless asked (Part 5 `brief`). No part adds a tool whose job a batch variant already does.

## Shared names (defined once, used across parts)

| Name | Defined in | Shape |
| --- | --- | --- |
| `getValkey(): Redis` | Part 1, `src/lib/valkey.ts` | ioredis client from `VALKEY_URL`, one per process, `maxRetriesPerRequest: null` |
| `Kv` / `valkeyKv()` / `memoryKv()` | Part 1, `src/lib/kv.ts` | `get(key)`, `set(key, value, ttlSeconds?)`, `setIfAbsent(key, value, ttlSeconds): Promise<boolean>`, `del(key)`, `hset(key, field, value, ttlSeconds?)`, `hgetall(key)`, `incr(key, ttlSeconds?)`. The web process uses `valkeyKv()` directly; tests pass `memoryKv()`. Key prefixes: `presence:` (Part 9), `active:` (Part 6), `gh:` (Part 7) |
| `closeValkey()`, `pingValkey()` | Part 1, `src/lib/valkey.ts` | shutdown and health |
| `JobQueue` / `bullQueue(name)` / `memoryQueue()` | Part 1, `src/lib/queue.ts` | `add(jobName: string, data: unknown, opts?: { jobId?: string; delayMs?: number }): Promise<void>`; `memoryQueue().jobs` lists what was added and honours `jobId` dedupe. Job ids contain no `:` and are never purely numeric |
| `QUEUE` | Part 1, `src/lib/queue.ts` | `{ feed: "feed", deliver: "deliver", github: "github", maintenance: "maintenance" }` |
| `EventBus` / `valkeyBus()` / `memoryBus()` | Part 1, `src/lib/bus.ts` | `publish(channel: string, message: object): Promise<void>`, `subscribe(channel, handler: (message) => void): Promise<() => void>` |
| `ChangeEvent` | Part 1, `src/worker/feed.ts` | `typeof changeLog.$inferSelect`: `{ id; projectId; systemId; entity; entityId; field; oldValue; newValue; authorUserId; agent; createdAt }`. Delivery is at least once and de-duplicated through the Postgres table `feed_seen`, so consumers must be idempotent |
| `registerFeedConsumer(name, handle)` | Part 1, `src/worker/feed.ts` | `handle(events: ChangeEvent[], deps: WorkerDeps): Promise<void>`; each consumer has its own cursor in `feed_cursor` |
| `registerJob(queue, jobName, handle)` | Part 1, `src/worker/jobs.ts` | `handle(data: unknown, deps: WorkerDeps): Promise<void>` |
| `registerRepeatable(queue, jobName, schedule, data?)` | Part 1, `src/worker/jobs.ts` | `schedule: { everyMs: number } \| { cron: string }`; the job is also registered with `registerJob` |
| `testDeps(db, overrides?)` | Part 1, `src/worker/deps.ts` | `WorkerDeps` with memory implementations, for feature-part tests |
| `registerMetric` | Part 1, `src/lib/metrics.ts` | adds a Prometheus metric to `/api/metrics` |
| `requireEnv`, `APP_REQUIRED_ENV`, `WORKER_REQUIRED_ENV` | Part 1, `src/lib/env.ts` | start checks; Part 6 appends `ENCRYPTION_KEY` |
| `WorkerDeps` | Part 1, `src/worker/deps.ts` | `{ db: Db; kv: Kv; bus: EventBus; queue: (name: keyof typeof QUEUE) => JobQueue; now: () => Date }` |
| `user_pref` table, `getPref` / `setPref`, `prefsRouter` | Part 1, `src/lib/ops/prefs.ts`, `src/server/trpc/routers/prefs.ts` | `(userId, key) → jsonb`. Part 3 adds value validation through `PREF_SCHEMAS` in `src/lib/pref-keys.ts`, and later parts add their keys there: `overview.panels`, `board.collapsed.<boardId>` (`{ columns, lanes }`), `mywork.seenAt` (Part 3), `notify.rules` (Part 6), `locale`, `timeZone` (Part 9) |
| `entityId`, `nullableEntityId`, `dbInt`, `MAX_INT` | Part 0, `src/lib/ops/params.ts` | shared id and integer schemas |
| `MIGRATION_LOCK`, `FIRST_ADMIN_LOCK` | Part 0, `src/db/locks.ts` | advisory lock keys |
| `ESTIMATE_POINTS`, `rollup`, `Rollup`, `systemRollups`, `groupRollups` | Part 2, `src/lib/ops/rollups.ts` | estimate rollups; `SystemListItem` gains `points`, `pointsDone`, `unestimated`, `blockedBy`, `fields` |
| `listBlockedTasks` | Part 2 | blocked tasks with reasons, for attention and My work |
| `FilterChip`, `ToggleChip` | Part 3, `src/components/filter-chip.tsx` (URL helpers in `src/lib/url-filters.ts`) | the one filter-chip component |
| `projectAttention`, `STALE_SYSTEM_DAYS`, `STALE_QUESTION_DAYS`, `HEALTH_QUIET_DAYS` | Part 3 | Needs attention on the server, stale and health rules |
| `myWork(db, actor, { now, changesLimit? })` | Part 3, `src/lib/ops/my-work.ts` | returns `MyWorkItem[]` with `section: "waiting" \| "changes"`; Part 6 adds the kind `mention` |
| `GATE_RULES`, `registerGateRule(rule)`, `GateRule`, `evaluateGates`, `GateResult`, `gateMessage` | Part 4, `src/lib/ops/gates.ts` | batch check `check(tx, subjects, param, now)`; Part 7 registers `pr-open` and `pr-merged` |
| `diffDocuments`, `unifiedDiff` | Part 4, `src/lib/diff.ts` | document diffs, reused by release notes |
| `glossaryBrief(db, projectId)` | Part 4 | glossary text for Part 5's project brief resource |
| `agent_run`, `agent_call`, `recordCall`, `bearerAuth`, `sessionAuth` | Part 5 | agent telemetry; `agent_call` has `runId`, `agent`, `projectId`, `systemSlug`, `at`. `bearerActor` and `sessionActor` stay as wrappers |
| `notify(tx, input)`, `NOTIFICATION_KINDS`, `DEFAULT_NOTIFY_RULES` | Part 6, `src/lib/ops/notifications.ts` | inserts `notification` rows inside the caller's transaction, deduped by `sourceKey`; delivery happens in the worker. Kinds are dotted (`question.answered`); Part 7 appends `pr.merged`, `checks.failed`, `automation.blocked` |
| `encryptSecret`, `decryptSecret` | Part 6, `src/lib/crypto.ts` | AES-256-GCM with `ENCRYPTION_KEY` |
| Realtime channels `project:<projectId>` and `user:<userId>` | Part 9 | message `{ keys: string[] }`: tRPC router names to invalidate, e.g. `["systems", "boards"]`, or `"presence"`; `user:` carries `notifications` |

## Review Focus

These are the conditions most likely to hurt someone and least likely to be caught by a part's own feature tests. Each part pins the lines that fall in its area.

1. **The worker is down or Valkey restarts:** web writes still succeed. Nothing is lost, because the change feed resumes from `feed_cursor`, and nothing is sent twice. Pinned in Part 1 (feed resume and dedupe tests).
2. **Two change-log rows commit out of id order** (a slow transaction holds a lower id): the feed still delivers both. Pinned in Part 1 (lookback window test).
3. **An agent retries a batch tool after a timeout:** a batch either applies completely or not at all, and a retried call does not duplicate tasks when it carries the same `clientRef`s. Pinned in Part 5.
4. **A notification, push or Discord message about a project reaches someone who cannot see that project** (removed member, removed account, archived project). Pinned in Part 6 (recipient filter tests) and Part 7 (code links only for linked repos).
5. **A webhook with a forged or missing signature** (GitHub app webhook, manual repo webhook): answered 401, with nothing enqueued. Pinned in Part 7.
