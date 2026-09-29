# roadmap-app Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A multi-project roadmap app on Postgres with Discord sign-in, per-user API keys, custom boards, a server-enforced planning gate, database-held specs/plans/ADRs/questions, an MCP server and REST API, and the `surf-roadmap` Claude Code plugin that replaces superpowers and surf-claude in linked repositories.

**Architecture:** One Next.js 16 service. Every read and write goes through an ops layer (`src/lib/ops/*`) that takes an `Actor`, validates with zod, checks project roles, writes in a transaction and appends to the change log. Server actions, the MCP route and the REST route are thin adapters over one tool registry built on that layer. Better Auth (Discord + api-key plugin) resolves sessions and bearer keys to the same `Actor`. The plugin lives in `plugin/` and is published by this repository as a marketplace.

**Tech Stack:** Next.js 16.3.7, React 19.3.0, Tailwind 4.3.3, shadcn/ui (CLI 4.21, Radix base, Nova preset, all components), Drizzle ORM 0.45.3 + drizzle-kit 0.31.11, postgres-js 3.4.9, PGlite 0.5.8 (tests), Better Auth 1.7.6 + @better-auth/api-key 1.7.6, @modelcontextprotocol/sdk 1.31.0, zod 4.6.5, vitest 5.0.2, TypeScript 6.0.x, ESLint 9, react-markdown 10.1.0 + remark-gfm 4.0.1, Node 22.

**Spec:** `docs/superpowers/specs/2026-09-29-roadmap-app-design.md`

## Parts

Execute in order. Each part ends with lint, typecheck, tests and build green and a commit.

| Part | File | Delivers |
| --- | --- | --- |
| 1 | `2026-09-29-roadmap-app-01-foundation.md` | Repo scaffold with shadcn/ui, Postgres schema, migrations, PGlite test harness, ops errors, ids, change log |
| 2 | `2026-09-29-roadmap-app-02-auth.md` | Better Auth + Discord, allowlist, admin users page, API keys page, bearer actor, `.env` for the user (**user checkpoint: Discord credentials**) |
| 3 | `2026-09-29-roadmap-app-03-ops-core.md` | Projects, members, boards/columns, domains/phases, systems, tasks, updates, questions, activity |
| 4 | `2026-09-29-roadmap-app-04-ops-planning.md` | Documents (spec/plan versions, plan→tasks), planning rounds and the gate, ADRs |
| 5 | `2026-09-29-roadmap-app-05-mcp-rest.md` | Tool registry, `/api/mcp`, `/api/v1/[...path]`, `/api/health` |
| 6 | `2026-09-29-roadmap-app-06-ui.md` | Project UI: home, nav, catalogue, boards, roadmap, system page with accordions, ADRs, questions, updates, members, activity, settings |
| 7 | `2026-09-29-roadmap-app-07-plugin.md` | `surf-roadmap` plugin: marketplace, MCP config, hooks, setup script, conventions, skills, commands, subagents |
| 8 | `2026-09-29-roadmap-app-08-deploy.md` | Dockerfile, compose (lean Postgres), CI + GHCR workflow, README |

## Global Constraints

- Node `>=22.12`. TypeScript `~6.0.3` (typescript-eslint supports `<6.1.0`). ESLint `^9`.
- All output is English: code, identifiers, comments, commits, docs, UI copy.
- Commits: Conventional Commits, capitalised subject (`feat: Add board columns`), one coherent change per commit, **no AI attribution lines, no emojis**. Commit freely, never push unless a step says so.
- Every function, class, interface and exported constant gets a doc comment that says what it does, never how it came to exist (no ADR/plan/conversation references).
- Ids are UUIDv7 strings from `newId()` (`src/lib/id.ts`), except `task.id` and `change_log.id` (serial integers). Timestamps are `timestamptz`, read as `Date`.
- Priorities are exactly `MVP`, `Later`, `Nice to have`. Task states `todo`, `doing`, `blocked`, `done`. Column categories `planning`, `todo`, `active`, `review`, `blocked`, `done`. Project roles `owner`, `editor`, `viewer`. Planning areas `failure-modes`, `dependencies`, `scope`, `ops-testing`.
- UI screens use only `@/components/ui/*` shadcn components plus Tailwind utilities; generated files in `src/components/ui/` are never edited by hand.
- Starting work assigns ownership: a task set to `doing` gets the actor as owner if unowned, and so does its system; moving a system into an `active` column claims an unowned system. Existing owners are never replaced.
- Slugs match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters.
- An entity in a project the actor cannot see is reported as not found (404), never forbidden. Too low a role is 403.
- HTTP status mapping: 400 invalid input, 401 no/invalid key, 403 role too low, 404 unknown or invisible, 409 planning gate, ADR immutability, invariant or uniqueness violation.
- API key prefix `rmk_`; api-key rate limit 600 requests per 60 s per key.
- Postgres container: `postgres:17-alpine`, `shared_buffers=32MB`, `max_connections=20`, `work_mem=2MB`, `maintenance_work_mem=16MB`, `effective_cache_size=64MB`, `mem_limit: 256m`, `cpus: 0.5`. App pool max 5 connections.
- Image `ghcr.io/slne-development/roadmap-app`, tags `latest` and `sha-<commit>`.
- Plugin name `surf-roadmap`, marketplace name `surf-roadmap`, link file `surf-roadmap.json` at the git top level, env vars `ROADMAP_URL` and `ROADMAP_API_KEY`.
- This repository is never linked (`surf-roadmap.json` must not exist here); its own spec and plan stay as files under `docs/superpowers/`.

## Review Focus

1. **Two writers allocating a number at once** (two agents creating ADRs, or writing a spec version, in parallel): both succeed with distinct consecutive numbers; no unique-violation error reaches the caller. Pinned in Part 4 (Task 4.1 and 4.3 concurrency tests), using a row lock on the parent (`SELECT … FOR UPDATE`).
2. **A removed account keeps a live session or API key**: after the admin removes the Discord ID, the next request with the old cookie or key is rejected. Pinned in Part 2 (Task 2.2 `loadActor` test and `removeAllowedAccount` test).
3. **Agent-written markdown containing raw HTML or `javascript:` links** in specs, plans, ADRs or updates: rendered as inert text. Pinned in Part 6 (Task 6.2 markdown test).
4. **A system moved to a column of another board, or a column edit that leaves a board without its planning column or any done column**: rejected with a message naming the rule. Pinned in Part 3 (Task 3.3 and 3.5 tests).
5. **Plugin hooks run outside a linked repo, in a subdirectory of one, or with malformed stdin**: outside, they print nothing and exit 0; in a subdirectory they find the git top level; malformed stdin never blocks the user's tool call (exit 0, no output). Pinned in Part 7 (Task 7.2 tests).
