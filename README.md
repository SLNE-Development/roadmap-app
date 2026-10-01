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
| `EVENT_UPLOADS_DIR` | no | Directory for uploaded event images, `/data/uploads` by default; compose mounts the `roadmap-uploads` volume there in `app` and `worker`. Publish-once files, no backup needed. |
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

Checks: `npm run check:worker-imports` (loads the worker's module graph under the `react-server` condition without
starting it), `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration` (needs Valkey), `npm run test:plugin`, `npm run build`.
Tests run against an in-process Postgres (PGlite) and need no Docker.

Full stack in Docker: `docker compose --profile app up -d --build`.
Set `APP_PORT`, `POSTGRES_PORT` and `VALKEY_PORT` to override default ports 3000, 5432 and 6379.

### Contributing: UI copy and translations

UI copy lives in `messages/<locale>/<namespace>.json` (English and German). A new namespace is registered in both
`messages/en/index.ts` and `messages/de/index.ts`. `src/i18n/untranslated.test.ts` fails on literal UI text in
`src/app/**` and `src/components/**`; its `PENDING_FILES` list must stay empty. Agent-facing text (tools, op errors,
MCP/REST, Discord messages) stays English.

The dev worker runs with the `react-server` condition, so server and worker code must import `use-intl/core`, never
`next-intl`. `npm run check:worker-imports` catches a slip.

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

## Language, time zone and presence

Each user can choose a language (English or German) and a time zone. The language applies to the UI
and to notifications written for that user; the time zone applies to how single timestamps are shown (activity,
notifications, release countdowns). Charts and day buckets stay in UTC. Both are user preferences (`locale`, `timeZone`). Pick the language in the account menu under Language; without a
choice the browser's `Accept-Language` decides. The time zone follows the browser automatically once per session.

Presence shows who else views a system: open pages post a heartbeat every 30 s to `/api/presence`, kept in Valkey
with a short expiry. Presence needs Valkey; when it is down, heartbeats are dropped quietly and nothing else breaks.

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
- `get_progress` (`GET /projects/:project/progress`): Task burn-up totals and a projected finish range; set series for daily points.
- `list_releases` (`GET /projects/:project/releases`): List releases with target date, status and done counts.
- `get_release` (`GET /projects/:project/releases/:release`): A release's readiness: systems, open questions, unmet gates, slip risk.

`list_systems` also takes a `release` filter, and `update_system` a `release` field that moves a system into a release or, with null, out of it.

## Insight and releases

- **Roadmap → Progress** shows the task burn-up (scope and done per day, in UTC days) with a projected finish range from the last two weeks' pace.
- **Releases** group systems that ship together. Editors plan a release and assign systems to it; owners freeze it, ship it and change a frozen release's scope. Shipping writes version 1 of the release notes, and a shipped release's scope is fixed.
- **Decisions → Map** draws the decisions with the systems and tasks they concern.
- **Activity → Export CSV** downloads the filtered activity. Scripts can fetch it with a session or with `Authorization: Bearer <ROADMAP_API_KEY>` at `GET /api/projects/:project/activity/csv`.

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

## Event requests

An event planner with no developer skills files a **request**: a brief written in Markdown, a date, a banner image, answers to the team's questions, a fallback plan and prep to-dos. A developer accepts it into a project (new or existing) and the planner follows the build progress. The same page posts the event's Discord messages. Open **Requests** in the sidebar. The full guide is [`docs/event-requests.md`](docs/event-requests.md).

Status flow: `draft` → `submitted` → `accepted` → `event_week` → `done`. A request can also be `withdrawn` (while it is a draft or submitted) or `cancelled` (once accepted). The requester can recall a submitted request to a draft until it is accepted. A cancelled request can be reopened (back to accepted), a withdrawn one becomes a draft again, and drafts, submitted, withdrawn and cancelled requests can be deleted; if the request created its project, the delete dialog lets you keep, archive or delete it.

### Roles

An admin sets two flags per account on the **Accounts** page of the Admin section (column **Event roles**):

- **Event manager**: sees every request, creates requests (also for someone else), edits them, posts the messages and edits the event settings.
- **Event developer**: sees submitted requests, asks questions and accepts requests into projects.

Admins have both. The requester of a request always sees and edits their own while it is open. Members of a request's linked project see it once it is submitted.

### Event settings

Event managers and admins open **Requests** → **Event settings** (`/requests/settings`); users without an event role get a not-found page. Managers edit the post-as name, the sender image, ping role id, Discord server id, time zone, rulebook link, the writing styles and examples (including the short description) and the details, disaster, resolved and cancelled ("Absage") templates; the disaster and resolved messages share one Störfall image. Discord loads the sender image from `/api/uploads/public/<id>` (served only while it is the configured sender image), so it shows up only when the app is reachable on a public URL (`BETTER_AUTH_URL`), not on `localhost`. The **webhook URLs and the bot token are admin-only**: managers see only whether each is set and its last four characters. They are encrypted with `ENCRYPTION_KEY` and are never shown again, in the UI, the API or logs.

### Nothing posts automatically

Every Discord message is a click on a button (**Post now**, **Edit**, **Delete messages**, **Send to staff channel**, **Post disaster message**, **Resolve**, **Cancel**). Agents can write message drafts and the event-day checklist but never post. Reminders are notifications only: an hourly worker job tells people that a message or to-do is due, that a request is waiting on someone, or that a submitted request has not been picked up. It never posts, never changes a status and never calls Discord. The app also never calls Claude: the **Copy prompts** dialog only gives you a text to paste into your own assistant.

### Discord setup

1. In your Discord server create **three webhooks** (Channel settings → Integrations → Webhooks): one for the **public announcements** channel, one for the **team** channel, one for a **staff test** channel.
2. Turn on Developer Mode (User settings → Advanced), right-click the role an announcement may ping and choose **Copy role ID**. Right-click the server and copy the server ID if you want real Discord events.
3. Optional, for real Discord scheduled events: create a bot in the Discord developer portal and invite it to the server with the **Manage Events** and **Create Events** permissions. The app uses the REST API only: no gateway connection and no intents.
4. An admin pastes the three webhook URLs and the bot token in **Event settings** → **Webhooks and bot**; a manager enters the ping role id and the server id under **Channels**.

Discord limits a message to 2,000 characters. Longer texts (up to 40,000 characters) are split at paragraph breaks into several messages; the details card (date, time, duration, place, links) is always its own last message. Date and time placeholders such as `{start_date}` or `{start_time}` become Discord timestamps, which every reader sees in their own time zone. There is no check-in and no separate event-day page: the **Event day** tab of the request holds the checklist, the fallback scenarios and the Störfall panel. Editing a split post updates every part and never pings. A post pings the role once, on its first message, and only if you tick the ping box. Test sends go to the staff channel only, never ping and never create a Discord event. If Discord cannot create the scheduled event, the announcement still posts with the details card and the post shows a note.

If a post stalls, check the channel, then press **Resume**. A crash between Discord answering and the database write can repeat one message; webhooks cannot de-duplicate, so the app cannot prevent that.

### Uploads volume

Banner and message images are stored in `EVENT_UPLOADS_DIR` (default `/data/uploads`), which both compose files mount from the named volume `roadmap-uploads` into `app` and `worker`. Files are publish-once, so the volume needs no backup. The Dockerfile creates the directory for the `node` user; if you replace the volume with a bind mount, run `chown 1000:1000` on the host directory. Both processes check at start that the directory is writable.

### Event tools for agents

- `get_request`: a request's brief, answers, progress, checklist, short description and the style guides to write in (`writing`).
- `ask_requester`: ask the planner a round of questions.
- `set_event_checklist` (`PUT /requests/:request/checklist`): replace the unticked items of the event-day checklist (ticked items stay).
- `write_event_messages` (`PUT /requests/:request/messages`): write the drafts of the team notice, announcement and reminder and the short description. Drafts only; kinds that are already posted are skipped.

The plugin command `/surf-roadmap:requests` has the sub-commands `update`, `event-day` and `messages`; see [`plugin/README.md`](plugin/README.md).

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
