# roadmap-app

Self-hosted, multi-project roadmap for teams that plan with agents. Projects hold
boards (workstreams with custom columns), systems with versioned specs and plans,
tasks, ADRs, open questions, progress updates and a full change log. A system
cannot leave its planning column until an exhaustive planning interview is
complete. Agents work through an MCP server and a REST API with per-user API keys;
the `surf-roadmap` Claude Code plugin in `plugin/` drives the whole workflow.

Stack: Next.js 16, React 19, shadcn/ui, Tailwind 4, Drizzle ORM on Postgres 17,
Better Auth (Discord), MCP TypeScript SDK.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection URL. Migrations run automatically at start. |
| `BETTER_AUTH_SECRET` | yes | Random secret signing sessions (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | yes | Public base URL, e.g. `https://roadmap.example.com`. |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | yes | Discord OAuth application. Redirect URL: `<BETTER_AUTH_URL>/api/auth/callback/discord`. |
| `ENCRYPTION_KEY` | yes | 32-byte base64 key encrypting stored secrets such as Discord webhook URLs and GitHub credentials (`openssl rand -base64 32`). |
| `VALKEY_URL` | yes | Valkey (Redis-compatible) URL for background jobs, caching and live updates. |
| `METRICS_TOKEN` | no | Bearer token for `/api/metrics` (Prometheus). Empty disables the endpoint. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no | Web Push keys (`npx web-push generate-vapid-keys`) and a `mailto:` or `https:` contact. Push is off unless all three are set. |
| `POSTGRES_PASSWORD` | compose only | Password of the bundled Postgres. |

Copy `.env.example` to `.env` and fill it in.

### Push notifications

Web Push sends notifications to browsers and phones. Generate a key pair once with
`npx web-push generate-vapid-keys`, set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and
`VAPID_SUBJECT` (e.g. `mailto:admin@example.com`) for both the app and the worker, and keep
the keys: new keys invalidate every saved device. Each person then turns push on under
**Notification settings → Devices**. Push needs HTTPS (or `localhost`); on iPhone and iPad
it works only from the app added to the home screen.

## Notifications

The bell in the sidebar and the **Notifications** inbox list what concerns you: questions on
your systems and answers to yours, planning rounds, assignments, blocked or finished work,
proposed ADRs, updates, and mentions. Type `@Name` in notes, questions, answers, updates or
planning answers to mention a project member; an agent's plain `@Name` resolves too when exactly
one member has that name. Each person chooses per kind what reaches the inbox and what is pushed,
and sets quiet hours, under account menu → **Notification settings**. Project owners post a
project's changes to Discord channels with webhooks under project **Settings → Notifications**,
optionally with a weekly digest. Push to browsers and phones needs the VAPID keys above (see
[Push notifications](#push-notifications)).

## Accounts

Only provisioned Discord accounts can sign in. The **first** account that signs in
becomes admin. Admins add people by Discord user ID under account menu →
**Accounts** (Discord: Developer Mode on, right-click a user, Copy User ID).
Removing an account ends its sessions and revokes its API keys immediately.

Anyone signed in can create projects and becomes their owner. Project roles:
viewer (read), editor (change content), owner (also members, boards, settings).

## Run locally

```bash
npm ci
docker compose up -d postgres valkey
npm run dev
```

In a second terminal, start the background worker: `npm run worker:dev`.

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` (needs Valkey), `npm run test:plugin`, `npm run build`.
Tests run against an in-process Postgres (PGlite) and need no Docker.

Full stack in Docker: `docker compose --profile app up -d --build`.
Set `APP_PORT`, `POSTGRES_PORT` and `VALKEY_PORT` to override default ports 3000, 5432 and 6379.

## Deploy on Coolify

`.github/workflows/image.yml` publishes `ghcr.io/slne-development/roadmap-app`
(`latest`, `sha-<commit>`) after CI passes on `main`.

You set `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`,
`DISCORD_CLIENT_SECRET` and `ENCRYPTION_KEY` (`openssl rand -base64 32`). Coolify generates the database password
(`SERVICE_PASSWORD_POSTGRES`). `BETTER_AUTH_URL` must be the exact public origin with
`https://`: Better Auth rejects sign-ins from any other origin with "Invalid origin".

1. Make the GHCR package `roadmap-app` public, or add registry credentials in Coolify,
   before the first pull.
2. In Coolify, create a Docker Compose resource from `docker-compose.coolify.yml`.
3. Set `BETTER_AUTH_URL` (e.g. `https://roadmap.example.com`), `BETTER_AUTH_SECRET`,
   `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `ENCRYPTION_KEY` (`openssl rand -base64 32`).
   Required since v2 Part 6; keep it — a new key breaks saved Discord webhooks.
4. Assign the same domain to the `app` service on port 3000, with `https://`.
5. Add `https://<domain>/api/auth/callback/discord` as a redirect in the Discord application.
6. Deploy, then sign in with Discord right away: the first account to sign in becomes admin.

The stack has four services: `app`, `worker`, `postgres` and `valkey`. Coolify generates
`SERVICE_PASSWORD_VALKEY` alongside the database password, and only `app` gets a domain.

Postgres runs with small buffers and a 256 MB / 0.5 CPU limit; the app keeps at
most 5 connections.

### Live updates

The browser keeps one server-sent-events connection (`/api/events/<project>`) per open project page and
refetches what a change notice names. Coolify's Traefik doesn't buffer streams, so nothing needs configuring
there. Behind nginx, set `proxy_buffering off` for `/api/events/`. The worker must be running for live
updates; without it, pages still work and update on navigation.

## Agents: MCP and REST

Create a key under account menu → **API keys**. It acts as you in every project
you belong to.

- **MCP** (streamable HTTP): `https://<host>/api/mcp`, header `Authorization: Bearer <key>`.
  With the plugin installed this is configured for you; without it:

  ```bash
  claude mcp add --transport http surf-roadmap https://<host>/api/mcp --header "Authorization: Bearer <key>"
  ```

- **REST**: `https://<host>/api/v1/...`, the same operations as the MCP tools, for
  example `GET /projects`, `GET /projects/{p}/systems/{s}`,
  `POST /projects/{p}/systems/{s}/updates`. Errors: 400 invalid input, 401 key,
  403 role, 404 unknown or invisible, 409 planning gate or ADR immutability.
  Unknown query parameters are rejected with 400. MCP writes default to the agent
  name "Claude Code"; REST writes carry no agent unless the body sets `agent`.
  Tasks are added in batches: `POST /projects/{p}/systems/{s}/tasks` takes
  `{ "tasks": [{ "title": "Write tests", "clientRef": "step-1" }] }` (1 to 50 tasks);
  a retry with the same `clientRef`s returns the existing tasks with `created: false`.
  The OpenAPI 3.1 document is at `/api/v1/openapi.json` and a readable reference at `/api/docs`, both without a key.

Batch tools (`add_tasks`, `update_tasks`, `answer_questions`) take up to 50 items and apply all or none.
`get_system`, `list_adrs` and `list_activity` answer briefly by default to save agents tokens; pass
`brief: false` (REST `?brief=false`) for full bodies, or read one with `get_document` / `get_adr`.

**Agents page:** each project has an **Agents** page with the runs that touched it: a
timeline of tool calls, failures and cost per system. The plugin's hooks name a run at
session start and report usage when it stops. They send the repository, branch, Claude
Code session id and token totals, never code or prompts.

**Tools added in v2:**

- `add_tasks` (`POST /projects/:project/systems/:system/tasks`, replaces `add_task`): Add up to 50 tasks to a system in one call. Pass a clientRef per task so a retried call returns the same tasks instead of adding them twice.
- `update_tasks` (`PATCH /tasks`): Change up to 50 tasks in one call, same fields as update_task. All changes apply or none do.
- `answer_questions` (`POST /projects/:project/questions/answers`): Answer up to 50 questions in one call; each resolves unless resolved is false. All apply or none do.
- `my_work` (`GET /my-work`): What is waiting on you across your projects: blocked and in-progress tasks, planning items, questions, proposed ADRs and unread mentions.
- `move_task` (`POST /tasks/:id/move`): Move a task to another system; it keeps its state, owner and checklist.
- `set_task_checks` (`PUT /tasks/:id/checks`): Replace a task's checklist; items matched by title keep their state.
- `set_dependencies` (`PUT /projects/:project/systems/:system/dependencies`): Set which systems this system depends on.
- `set_system_fields` (`PATCH /projects/:project/systems/:system/fields`): Set custom field values of a system by key.
- `archive_system` (`POST /projects/:project/systems/:system/archive`): Archive a system or restore it.
- `set_question_priority` (`PATCH /projects/:project/questions/:id/priority`): Set a question's priority: blocking, normal or nice.

## GitHub

Connect GitHub so pull requests and checks show up on tasks and systems. Repositories linked through the GitHub App send pull requests, pushes and checks; repositories added by hand send pull requests and pushes, but no checks.

1. An admin opens the account menu, then **GitHub App** under the Admin section, clicks **Create GitHub App** and confirms on GitHub. Then **Install on an account or org** and pick the repositories.
2. Project owners link repositories under project **Settings** → **GitHub**. People link their own GitHub login under account menu → **Connections**.
3. Repositories outside the app can be added by hand: add a webhook with the URL and secret shown in the panel.

The app requests read-only permissions: Metadata, Contents, Pull requests and Checks.

`BETTER_AUTH_URL` must be the public origin: the app's webhook and callback URLs are derived from it when the app is created. If the domain changes later, update those URLs in the app's settings on GitHub. GitHub cannot reach `localhost`, so creating the app from a local dev server fails; use a public URL (for example a tunnel) as `BETTER_AUTH_URL`, or choose **Use an existing app**.

### Referencing tasks from pull requests

- `roadmap#<id>` in a pull request title links the task. When the repository's Close tasks rule is on, the task is closed on merge.
- `roadmap:<system-slug>` in the body links the pull request to the system. The body only links and never closes anything.
- Never use a bare `#<id>`: GitHub reads it as an issue, not a task.

Example title: `Add rate limiting [roadmap#42 roadmap#43]`.

Owners can turn on three rules per repository (all off by default):

- **Close tasks when a PR merges**: tasks referenced in the title are set to done on merge.
- **Move to review when a PR opens**: a linked system in a todo, active or blocked column moves to the board's first review column, unless a column gate refuses it.
- **Warn when checks fail**: the system owner is notified when a linked pull request's checks fail (GitHub App repositories only).

Changes are made as the PR author when they linked their GitHub login and can edit the project, otherwise as the owner who linked the repository; with neither, the rule is skipped.

## The surf-roadmap plugin

```
/plugin marketplace add SLNE-Development/roadmap-app
/plugin install surf-roadmap@surf-roadmap
```

Set `ROADMAP_URL` and `ROADMAP_API_KEY`, start Claude Code in a repository and run
`/surf-roadmap:setup`. Details: [`plugin/README.md`](plugin/README.md).

## Backups

```bash
docker compose exec postgres pg_dump -U roadmap roadmap > roadmap-$(date +%F).sql
```
