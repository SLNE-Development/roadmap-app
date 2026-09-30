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
| `POSTGRES_PASSWORD` | compose only | Password of the bundled Postgres. |

Copy `.env.example` to `.env` and fill it in.

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
docker compose up -d postgres
npm run dev
```

Checks: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:plugin`, `npm run build`.
Tests run against an in-process Postgres (PGlite) and need no Docker.

Full stack in Docker: `docker compose --profile app up -d --build`.
Set `APP_PORT` and `POSTGRES_PORT` to override default ports 3000 and 5432.

## Deploy on Coolify

`.github/workflows/image.yml` publishes `ghcr.io/slne-development/roadmap-app`
(`latest`, `sha-<commit>`) after CI passes on `main`.

You set `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID` and
`DISCORD_CLIENT_SECRET`. Coolify generates the database password
(`SERVICE_PASSWORD_POSTGRES`). `BETTER_AUTH_URL` must be the exact public origin with
`https://`: Better Auth rejects sign-ins from any other origin with "Invalid origin".

1. Make the GHCR package `roadmap-app` public, or add registry credentials in Coolify,
   before the first pull.
2. In Coolify, create a Docker Compose resource from `docker-compose.coolify.yml`.
3. Set `BETTER_AUTH_URL` (e.g. `https://roadmap.example.com`), `BETTER_AUTH_SECRET`,
   `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
4. Assign the same domain to the `app` service on port 3000, with `https://`.
5. Add `https://<domain>/api/auth/callback/discord` as a redirect in the Discord application.
6. Deploy, then sign in with Discord right away: the first account to sign in becomes admin.

Postgres runs with small buffers and a 256 MB / 0.5 CPU limit; the app keeps at
most 5 connections.

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
