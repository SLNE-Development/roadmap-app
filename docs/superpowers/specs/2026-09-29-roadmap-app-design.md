# roadmap-app: multi-project roadmap with Discord auth, MCP and the surf-roadmap plugin

Date: 2026-09-29
Status: Draft for review
Repository: `git@github.com:SLNE-Development/roadmap-app.git` (public)
Image: `ghcr.io/slne-development/roadmap-app`

This repository keeps its own spec and plan as files in the repository. It is not
linked to a roadmap project, so its own plugin never governs it.

## 1. Goal

A self-hosted roadmap app, forked from `surf-roleplay/roadmap-app`, that:

- stores everything in Postgres instead of SQLite;
- signs users in with Discord through Better Auth, only for accounts an admin
  provisioned;
- gives every user API keys that act as that user;
- holds multiple projects, each with multiple boards whose columns are custom;
- stores specs, plans, ADRs and open questions in the database instead of repository
  files;
- enforces an exhaustive, adversarial planning interview before any system leaves
  planning;
- ships a Claude Code plugin, `surf-roadmap`, whose skills replace every
  superpowers skill and every `surf-claude` convention, and talk to the app's MCP
  server.

Success means a team member can install the plugin, run `/surf-roadmap:setup` in a
repository, plan a system through the roast interview, and have the spec, plan,
tasks, ADRs, questions and progress appear in the app, with no spec or plan file
written into the repository.

## 2. Out of scope

- Migrating data from the old SQLite app. The new app starts empty, and the seed
  scripts are deleted.
- Changing `S:\Workspaces\surf-roleplay`. Its `roadmap-app`, `.mcp.json` and
  `surf-roadmap` skill stay as they are. Replacing them is a later, separate task.
- Changing the `surf-claude` repository.
- OAuth for MCP. Agents authenticate with API keys only.
- Email/password or any login provider other than Discord.
- Real-time updates (websockets). Pages render fresh on navigation.

## 3. Starting point

The new app is copied from `S:\Workspaces\surf-roleplay\roadmap-app` without
`node_modules`, `.next`, `data/`, `.env`, `seed/`, `src/db/seed*.ts`,
`src/db/seed-types.ts` and `tsconfig.tsbuildinfo`. The old copy stays untouched.

The stack is upgraded to the latest stable versions: Next.js (App Router), React,
Tailwind 4, Drizzle ORM with `drizzle-kit` migrations, the `postgres` (postgres-js)
driver, Better Auth, `@modelcontextprotocol/sdk`, zod, vitest. The existing visual
style (CSS variables, `card`, `btn`, `eyebrow`) is kept.

Every data access becomes async, because the SQLite layer was synchronous.

## 4. Architecture

One Next.js service holds everything:

```
Browser ──> Next.js pages / server actions ─┐
Agent (MCP) ──> /api/mcp  ──────────────────┼──> ops layer (src/lib/ops/*) ──> Drizzle ──> Postgres
Script (REST) ──> /api/v1/... ──────────────┘         │
Better Auth ──> /api/auth/[...all]                    └── permission checks, change log, planning gate
```

- **Ops layer** (`src/lib/ops/`): one module per area (projects, boards, systems,
  tasks, planning, documents, adrs, questions, updates, members). Every operation
  takes an `Actor` (`{ userId, isAdmin, agent?: string }`) and a validated zod
  input, checks permissions, writes, and appends to the change log in one
  transaction. UI server actions, MCP tools and REST routes are thin adapters over
  it. There is no business logic outside the ops layer.
- **Auth**: Better Auth with the Discord social provider, the `apiKey` plugin and
  the Drizzle adapter on the same database. The session serves the UI; an
  `Authorization: Bearer <api key>` header serves MCP and REST. Both resolve to the
  same `Actor`.
- **Migrations**: `drizzle-kit generate` produces SQL files that are committed. The
  app applies pending migrations at startup (`instrumentation.ts`) before it serves
  anything.

## 5. Data model

All ids are text (UUIDv7) unless stated. All timestamps are `timestamptz`.

### 5.1 Auth and users

- Better Auth tables: `user`, `session`, `account`, `verification`, `apikey`.
- `user` gets the extra fields `discordId` (unique) and `isAdmin` (boolean).
- `allowedAccount`: `discordId` (primary key), `displayName`, `createdBy`,
  `createdAt`.

Sign-in rule, enforced in a Better Auth database hook before a user or session is
created:

1. If no user exists yet, the signing-in Discord account is accepted and becomes
   admin. It is also written to `allowedAccount`.
2. Otherwise the Discord ID must be in `allowedAccount`; otherwise sign-in fails
   and the login page shows "Your Discord account has not been added. Ask an
   admin."

Removing an `allowedAccount` deletes that user's sessions and revokes their API
keys; project memberships are kept but inert. The last admin cannot remove
themselves or drop their admin flag.

### 5.2 Projects, members, boards

- `project`: `id`, `slug` (unique, `[a-z0-9-]+`), `name`, `description`,
  `createdAt`.
- `projectMember`: `projectId`, `userId`, `role` (`owner` | `editor` | `viewer`),
  primary key on both ids. The creator becomes `owner`. A project always keeps at
  least one owner.
- `board`: `id`, `projectId`, `slug` (unique per project), `name`, `sortOrder`.
- `boardColumn`: `id`, `boardId`, `name`, `category`, `sortOrder`.
  - `category` ∈ `planning`, `todo`, `active`, `review`, `blocked`, `done`.
  - Every board has exactly one `planning` column and at least one `done` column.
  - A new board gets the default columns Planning, Todo, In progress, Review,
    Blocked, Done. Columns can then be renamed, reordered, added and removed.
  - A column that still holds systems cannot be deleted; the error names how many.

A project is created with one board named "Development".

### 5.3 Project content

- `domain`: `id`, `projectId`, `name`, `description`, `sortOrder`.
- `phase`: `id`, `projectId`, `name`, `goal`, `sortOrder`;
  `phaseDependency(phaseId, dependsOnId)` within one project.
- `system`: `id`, `projectId`, `boardId`, `columnId`, `domainId?`, `phaseId?`,
  `slug` (unique per project, used in URLs and tools), `title`, `summary`,
  `priority` (`P0`–`P3`, as today), `ownerUserId?`, `notes`, `sortOrder`,
  `planningCompletedAt?`, `planningConfirmation?` (the user's verbatim
  confirmation), `createdAt`.
  - `columnId` must belong to `boardId`. Moving a system to another board requires
    a target column.
- `task`: `id` (serial integer, readable for agents), `systemId`, `title`,
  `state` (`todo` | `doing` | `blocked` | `done`), `priority`, `ownerUserId?`,
  `planStep?` (integer), `sortOrder`.
- `systemDocument`: `id`, `systemId`, `kind` (`spec` | `plan`), `version`
  (1, 2, …, per system and kind), `body` (markdown), `authorUserId`, `agent?`,
  `createdAt`. Append-only: an edit writes a new version.
- `adr`: `id`, `projectId`, `number` (per project, 1, 2, …, displayed as `0001`),
  `title`, `status` (`proposed` | `accepted` | `superseded`), `context`,
  `decision`, `alternatives`, `consequences`, `supersedesId?`, `supersededById?`,
  `acceptedAt?`, author fields. `adrSystem(adrId, systemId)` links ADRs to systems.
  - A proposed ADR can be edited. An accepted ADR cannot be edited; the server
    rejects it. The only change allowed is being superseded, which sets `status`
    and `supersededById` on the old ADR and `supersedesId` on the new one.
  - Numbers are never reused.
- `question`: `id`, `projectId`, `systemId?`, `title`, `text`, `answer?`,
  `resolved`, author fields, `createdAt`, `resolvedAt?`.
- `progressUpdate`: `id`, `systemId`, `taskId?`, `summary`, `nextStep?`,
  `commitHash?`, `authorUserId`, `agent?` (agent name, e.g. "Claude Code"),
  `createdAt`. Shown as "Claude Code (for Alex)" when `agent` is set, else "Alex".
- `changeLog`: `id`, `projectId`, `entity`, `entityId`, `field`, `oldValue?`,
  `newValue?`, `authorUserId`, `agent?`, `createdAt`.

Each project carries its own repository URL for commit links: `project.repoUrl?`.

### 5.4 Planning

- `planningRound`: `id`, `systemId`, `number`, `createdAt`, author fields.
- `planningItem`: `id`, `roundId`, `area`, `question`, `answer?`, `isRisk`
  (a failure mode the interviewer flagged), `status` (`open` | `answered` |
  `accepted-risk`), `sortOrder`.
  - `area` ∈ `failure-modes`, `dependencies`, `scope`, `ops-testing`.
  - `accepted-risk` means the user explicitly accepted a flagged risk; it requires
    an answer that states why.

**The planning gate.** A system is created in its board's `planning` column. Any
move to a non-planning column, and any task set to `doing` or `done`, is rejected
until planning is complete. `complete_planning` succeeds only when all of these hold:

1. every area has at least one item with status `answered` or `accepted-risk`;
2. no item has status `open`;
3. a spec document exists for the system;
4. the request carries `userConfirmation`: the user's own words confirming the
   spec, quoted verbatim.

If any fails, the error lists every failing condition, with item ids. On success
`planningCompletedAt` and `planningConfirmation` are set. Planning can be reopened
(`reopen_planning`, editor or higher), which clears both fields and moves the
system back to the planning column.

## 6. Permissions

| Action | viewer | editor | owner | admin |
| --- | --- | --- | --- | --- |
| Read a project | yes | yes | yes | every project |
| Write systems, tasks, documents, planning, ADRs, questions, updates, domains, phases | no | yes | yes | yes |
| Manage boards and columns, members, project settings; delete the project | no | no | yes | yes |
| Manage `allowedAccount` and admins | no | no | no | yes |

Any provisioned user can create a project. A user sees only projects they belong
to; the admin sees all. API keys act as their user with all of that user's rights.
A request for a project the actor cannot see returns "not found", not "forbidden".

## 7. UI

- **Login** (`/login`): one "Sign in with Discord" button and the rejection message
  from 5.1.
- **Home** (`/`): the actor's projects as cards, plus "New project" (name, slug,
  description, repository URL).
- **Navigation**: project switcher; under a project: Catalogue, Boards, Roadmap,
  ADRs, Questions, Updates, Members, Activity, Settings. Right side: user avatar
  menu with API keys, Admin (admins only) and Sign out. The localStorage display
  name is removed; the signed-in user is the author.
- `/p/[project]`: catalogue of systems, filterable by board, domain, phase, column
  category, priority and owner.
- `/p/[project]/boards/[board]`: one tab per board, kanban over the board's columns.
  Owners get "New board" and a column editor (name, category, order).
- `/p/[project]/roadmap`, `/adrs`, `/adrs/[number]`, `/questions`, `/updates`,
  `/members` (owners add members by picking a provisioned user and a role),
  `/activity`, `/settings` (name, description, repository URL, domains, phases,
  delete).
- `/p/[project]/systems/[system]`, top to bottom:
  1. header: domain, phase, board, title, summary;
  2. spec: latest version rendered, with a version picker;
  3. plan: latest version rendered, with a version picker (hidden when none);
  4. open questions of the system;
  5. **task list**;
  6. **Planning** accordion: every round with its items, area, risk marker,
     status and answer, then the confirmation quote;
  7. **Agent updates** accordion: the progress updates;
  8. **History** accordion: the change log.

  Accordions 6–8 are closed by default and show their entry count in the summary
  line. The sidebar keeps the editor (column, priority, owner, notes) and shows the
  planning status; while planning is incomplete, non-planning columns are
  disabled with the reason.
- `/settings/api-keys`: create a key (name, optional expiry), shown once with
  copyable `ROADMAP_URL` and `ROADMAP_API_KEY` lines; list and revoke keys.
- `/admin/users`: add a Discord ID with a display name, remove it, grant or
  revoke admin.

## 8. MCP server

Endpoint `/api/mcp`, streamable HTTP, stateless, `Authorization: Bearer <api key>`.
Every write tool takes an optional `agent` (defaults to "Claude Code"). Every
project-scoped tool takes `project` (slug). Tools return JSON text; errors are
returned as `isError` with the ops layer's message.

| Area | Tools |
| --- | --- |
| Identity | `whoami` |
| Projects | `list_projects`, `get_project`, `create_project`, `update_project`, `list_members` |
| Boards | `list_boards`, `create_board`, `update_board`, `set_board_columns` |
| Structure | `list_domains`, `create_domain`, `list_phases`, `create_phase` |
| Systems | `list_systems`, `get_system`, `create_system`, `update_system`, `move_system` |
| Planning | `get_planning`, `add_planning_round` (a batch of items), `answer_planning_items`, `complete_planning`, `reopen_planning` |
| Documents | `get_document` (latest or a version), `write_spec`, `write_plan` |
| Tasks | `add_task`, `update_task` |
| Progress | `post_update`, `list_updates` |
| ADRs | `list_adrs`, `get_adr`, `create_adr`, `update_adr` (proposed only), `accept_adr`, `supersede_adr` |
| Questions | `list_questions`, `add_question`, `answer_question` |
| Activity | `list_activity` |

`write_plan` takes the markdown body and a list of steps `{ step, title }`. It
creates a new plan version, creates a task for each step that has no task with that
`planStep` yet, and renames tasks whose step title changed. It never deletes tasks;
steps that disappeared are reported in the result.

The server instructions tell agents: every new system goes through
`surf-roadmap:plan-system` before anything else; specs and plans are written with
`write_spec` and `write_plan`, never as files.

## 9. REST API

`/api/v1/...`, the same bearer key, JSON bodies, backed by the same ops layer.
Routes mirror the tools, for example `GET /projects`, `GET /projects/{p}/systems`,
`PATCH /projects/{p}/systems/{s}`, `POST /projects/{p}/systems/{s}/updates`,
`POST /projects/{p}/adrs`. Status codes: 400 invalid input (message names the
field), 401 no or invalid key, 404 unknown or invisible entity, 409 planning gate
or ADR immutability violation (message lists what is missing).

## 10. The `surf-roadmap` plugin

It lives in this repository and is published by the same repository as a
marketplace:

```
.claude-plugin/marketplace.json          marketplace "surf-roadmap"
plugin/
  .claude-plugin/plugin.json             name "surf-roadmap"
  .mcp.json                              server "surf-roadmap"
  hooks/hooks.json
  hooks/*.mjs                            Node, no dependencies
  agents/*.md                            subagents with pinned models (10.8)
  skills/<name>/SKILL.md
  commands/*.md
  conventions/                           CLAUDE.md blocks, adapted from surf-claude
  scripts/surf-roadmap.mjs               setup/audit helper, no dependencies
```

Install: `/plugin marketplace add SLNE-Development/roadmap-app`, then
`/plugin install surf-roadmap@surf-roadmap`.

### 10.1 MCP configuration

`.mcp.json` points to `${ROADMAP_URL}/api/mcp` with the header
`Authorization: Bearer ${ROADMAP_API_KEY}`. Both are environment variables the user
sets; the API key page in the app shows the exact lines.

### 10.2 `surf-roadmap.json`

In the repository root, committed:

```json
{ "project": "surf-roleplay", "board": "development" }
```

A repository is **linked** when this file exists at its git top level. All hooks
below act only in linked repositories.

### 10.3 `/surf-roadmap:setup`

Runs first in every repository. In order:

1. Checks `ROADMAP_URL` and `ROADMAP_API_KEY` and calls `whoami`. On failure it
   says which is missing or rejected and how to fix it, and stops.
2. Asks which project (existing ones, or create a new one) and which default board,
   and writes `surf-roadmap.json`.
3. **Worktrees tree**, only if `~/.claude/CLAUDE.md` contains a worktree restriction:
   "Do you want to remove your global constraint on using worktrees?"
   - Yes → removes that block from `~/.claude/CLAUDE.md`. Nothing else.
   - No → "Do you want to allow worktrees in this repository?" → writes the
     `worktrees` block (allowed or forbidden) into the repository's `CLAUDE.md`.

   With no global restriction, no question is asked and no block is written.
4. **SDD tree**, the same shape for a global restriction on subagents or
   subagent-driven development, writing the `execution-mode` block
   (subagent or inline).
5. Writes the convention blocks into `CLAUDE.md`, never overwriting unmarked
   content, using `surf-claude`'s marker format under the `surf-roadmap:` prefix.
6. Adds `.superpowers/` and `.claude/settings.local.json` to `.gitignore`, and
   `.worktrees/` when worktrees were allowed.
7. Warns when the `surf` plugin from `surf-claude` or the `superpowers` plugin is
   enabled: both keep working elsewhere, but `surf-roadmap` overrides them in linked
   repositories.
8. Reports what it created, skipped and set.

### 10.4 Conventions (from `surf-claude`, adapted)

Carried over as `CLAUDE.md` blocks: language (English only), never assume (ask
with the question tool, batched rounds), commits (logical grouping, Conventional
Commits, no emojis, **no AI attribution**, commit freely, never push unasked), doc
comments (what the code does, never how it came to exist), worktrees, execution
mode.

Changed: the workflow block becomes *prompt → planning interview → spec (in the
roadmap) → plan (in the roadmap) → execution*. ADRs, plans, specs and open
questions live in the roadmap; no `docs/adr`, `docs/plans`, `docs/specs` or
`docs/superpowers` directories are created. The ADR criteria from `surf-claude`
(constrains future work, expensive to reverse, trades properties, security model,
public API or format, new runtime dependency) are kept.

### 10.5 Skills

Each superpowers skill has a replacement that keeps its method and routes every
artifact through the MCP. Forked content keeps the MIT notice of superpowers.

| superpowers | surf-roadmap | What changes |
| --- | --- | --- |
| using-superpowers | `using-surf-roadmap` | Skill discovery for this plugin; states the override. |
| brainstorming | `plan-system` | The roast interview (10.6); ends in `write_spec` and `complete_planning`. |
| writing-plans | `write-plan` | Requires completed planning and every needed ADR accepted; `write_plan` with steps. |
| executing-plans | `execute-plan` | Reads the plan and tasks via MCP; sets tasks `doing`/`done`, `post_update` after each commit. |
| subagent-driven-development | `subagent-driven-development` | Same, and every subagent prompt carries the project, system and task ids and the MCP rules. |
| dispatching-parallel-agents | `dispatching-parallel-agents` | Respects the execution-mode block. |
| using-git-worktrees | `using-git-worktrees` | Respects the worktrees block; asks when absent. |
| test-driven-development | `test-driven-development` | Unchanged method. |
| systematic-debugging | `systematic-debugging` | Root causes that block a system become `add_question` or a blocked task. |
| verification-before-completion | `verification-before-completion` | Evidence goes into the progress update. |
| requesting-code-review | `requesting-code-review` | Review scope comes from the plan's tasks. |
| receiving-code-review | `receiving-code-review` | Unchanged method. |
| finishing-a-development-branch | `finishing-a-development-branch` | Marks tasks and moves the system to review or done. |
| writing-skills | `writing-skills` | Unchanged method. |
| diagnosing-superpowers | none | Blocked without a replacement; the hook says so. |

Additional skills: `setup` (10.3), `check-project` (audits the repository against
the conventions, like `surf-claude`), `new-adr` (the `surf-claude` rules; writes
via `create_adr`/`accept_adr`/`supersede_adr`), `open-question`, `track-work`
(status, updates after every commit, blockers).

Commands: `/surf-roadmap:plan <idea>` (runs `plan-system`), `/surf-roadmap:status`
(the linked project's active and blocked systems), `/surf-roadmap:next` (proposes
the next task by phase, priority and dependencies, and asks before starting).

### 10.6 The planning interview (`plan-system`)

- **Tone:** savage about the plan, profanity allowed. It mocks hand-waving, vague
  scope and missing edge cases, and gives no praise. It attacks the plan, never the
  person, never refuses to continue, and always ends in a clean, neutral spec.
- **Method:** in rounds of up to four questions (the question tool's limit), as
  many rounds as needed. Each round is stored with `add_planning_round` before it is
  asked, and the answers with `answer_planning_items` right after.
- **Coverage:** failure modes and edge cases (concurrency, bad input, abuse,
  exploits, crashes, data loss), dependencies and integration (other systems,
  ordering, contracts, migrations), scope and non-goals (MVP cut, acceptance
  criteria), ops and testing (performance, configuration, permissions, logging, test
  approach).
- **Risk flagging:** every way the design can go wrong is recorded as an item with
  `isRisk`, and the user must either answer how it is handled or accept the risk
  with a reason.
- **Before finishing:** it reads existing systems, ADRs and questions to find
  conflicts and dependencies; every decision that meets the ADR criteria becomes an
  ADR proposal the user accepts.
- **End:** writes the spec with `write_spec`, shows it, asks the user to confirm in
  their own words, then calls `complete_planning` with that quote. If the server
  lists gaps, it goes back to asking.

### 10.7 Hooks (active only in linked repositories)

- **SessionStart:** injects the linked project and board, the rule "use
  `surf-roadmap:*` skills; `superpowers:*` skills are unavailable here", and a
  one-line summary from `whoami` (a failure is reported, not fatal).
- **PreToolUse `Skill`:** denies any `superpowers:*` skill with the reason
  "Use `surf-roadmap:<replacement>` in this repository."
- **PreToolUse `Write|Edit|MultiEdit|NotebookEdit`:** denies paths under
  `docs/superpowers/`, `docs/adr/`, `docs/plans/`, `docs/specs/` and `docs/spec/`,
  with the reason naming the MCP tool to use instead.

Hooks are Node scripts with no dependencies, so they run on Windows, macOS and
Linux.

### 10.8 Subagents

Shipped in `plugin/agents/*.md`. Each pins its `model` and its `tools` in the
frontmatter, and sets a reasoning effort where the frontmatter supports it; whether
it does is checked against the current Claude Code docs during implementation, and
where it does not, the effort line is left out rather than guessed. Every agent
prompt carries the conventions from 10.4, and the rule that a subagent never makes a
decision that needs a human: it stops and reports the question to its parent.

| Agent | Model | Tools | Job |
| --- | --- | --- | --- |
| `implementer` | sonnet | all edit tools, Bash, roadmap MCP | One plan task via TDD; commits; sets the task `doing` then `done`; `post_update`. Used by `subagent-driven-development`. |
| `code-reviewer` | sonnet, medium | read-only, roadmap MCP read | Routine review of a diff: bugs, quality, conventions (doc comments, commits). |
| `deep-reviewer` | opus, medium | read-only, roadmap MCP read | Final and whole-branch review, the same checks in depth. |
| `spec-reviewer` | opus, medium | read-only, roadmap MCP read | Checks an implementation against the system's spec and plan task; reports gaps and over-building. |
| `security-reviewer` | opus | read-only | Auth, injection, secrets, permission checks, exploit paths. |
| `red-team` | sonnet | read-only, roadmap MCP read | Feeds `plan-system`: from the draft idea and existing systems, ADRs and questions, lists every failure mode, conflict and dependency to ask about. The main session still asks the user. |
| `plan-checker` | sonnet | read-only, roadmap MCP read | Before execution: flags unverifiable steps, a missing out-of-scope or risk section, and decisions without an accepted ADR. |
| `debugger` | sonnet | read, Bash, edit | Systematic root-cause investigation; an unresolved blocker becomes `add_question`. |
| `test-writer` | sonnet | edit, Bash | Adds or strengthens tests for an existing change without touching production code. |
| `adr-writer` | haiku | roadmap MCP | Writes a decision the user already made as a complete ADR with `create_adr`. |
| `explorer` | haiku | read-only | Codebase search that returns conclusions, not file dumps. |
| `doc-commenter` | haiku | read, edit | Adds doc comments per the convention, one file per batch. |
| `progress-reporter` | haiku | read, Bash (git), roadmap MCP | Summarises commits since the last update into a `post_update`. |

The replacement skills name these agents where superpowers dispatches generic
subagents, for example `subagent-driven-development` uses `implementer`, then
`spec-reviewer`, then `code-reviewer`, and `finishing-a-development-branch` uses
`deep-reviewer`.

## 11. Deployment

- `Dockerfile`: multi-stage, Next.js standalone output, non-root, no native build
  tools (postgres-js is pure JavaScript). The health check hits a `/api/health`
  route that checks the database.
- `docker-compose.yml` (local) and `docker-compose.coolify.yml`: services `app` and
  `postgres` (`postgres:17-alpine`) with a named volume. Postgres runs with
  `shared_buffers=32MB`, `max_connections=20`, `work_mem=2MB`,
  `maintenance_work_mem=16MB`, `effective_cache_size=64MB`, and compose limits
  `mem_limit: 256m`, `cpus: 0.5`. The app pool uses at most 5 connections.
- GitHub Actions: CI (lint, typecheck, tests, build) on every push and pull
  request; image build and push to `ghcr.io/slne-development/roadmap-app`
  (`latest`, `sha-<commit>`) on `main`. The package stays private until the user
  makes it public.
- Environment, documented in `.env.example`: `DATABASE_URL`, `BETTER_AUTH_SECRET`,
  `BETTER_AUTH_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `POSTGRES_PASSWORD`
  (compose only). The Discord redirect URL to register is
  `<BETTER_AUTH_URL>/api/auth/callback/discord`.

## 12. Testing

- vitest with PGlite (in-process Postgres) and the same migrations, so tests need no
  Docker. Covered: the ops layer per area, the planning gate (every failing
  condition), ADR immutability and superseding, permissions per role, board column
  invariants, `write_plan` task syncing, the sign-in allowlist rule, and each MCP
  tool through an in-memory MCP client.
- Plugin hooks: Node's built-in test runner, feeding hook JSON on stdin and checking
  the decision for linked and unlinked repositories.
- Before any milestone is called done: `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`, and a smoke test of `/api/mcp` against a running
  instance.

## 13. Order of delivery

1. Copy, strip seeds, upgrade stack, Postgres, migrations, tests on PGlite.
2. Better Auth with Discord, the allowlist, admin page, `.env.example`. The user
   supplies the Discord credentials at this point.
3. API keys and the bearer path for MCP and REST.
4. Projects, members, boards, columns, and the UI to match.
5. Documents, planning, ADRs, questions; system page layout with the accordions.
6. MCP tools and REST routes for everything.
7. The plugin: conventions, setup, skills, commands, hooks, subagents.
8. Docker, compose, CI, README.
9. Update `~/.claude/CLAUDE.md` only if a remaining rule conflicts. (The worktree
   and subagent blocks were already removed on 2026-09-29.)
