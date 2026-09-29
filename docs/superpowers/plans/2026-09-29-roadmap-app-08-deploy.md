# Part 8: Docker, compose, CI and README

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read the index first: its Global Constraints apply to every task.

**Goal:** A production image that migrates on start, a lean Postgres next to it for local use and Coolify, CI that runs every check, an image workflow publishing to GHCR, and a README that gets someone from zero to a running instance and an installed plugin.

**Spec:** section 11.

---

### Task 8.1: Dockerfile and compose files

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `docker-compose.coolify.yml`
- Modify: `docker-compose.yml` (add the app service)

- [ ] **Step 1: Write the Dockerfile and .dockerignore**

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# ---- dependencies ----
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: Next.js standalone output ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime: standalone server plus migrations, as the non-root node user ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
```

`.dockerignore`:

```
node_modules
.next
.env*
!.env.example
npm-debug.log*
Dockerfile
docker-compose*.yml
.git
plugin
docs
```

- [ ] **Step 2: Add the app to the local compose file**

Replace `docker-compose.yml`:

```yaml
# Local stack: the app built from source plus a lean Postgres. Values come from .env.
# Only Postgres: `docker compose up -d postgres` (for `npm run dev`).
services:
  app:
    build: .
    image: roadmap-app:local
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://roadmap:${POSTGRES_PASSWORD:-roadmap}@postgres:5432/roadmap
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET}
      BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3000}
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID:?Set DISCORD_CLIENT_ID}
      DISCORD_CLIENT_SECRET: ${DISCORD_CLIENT_SECRET:?Set DISCORD_CLIENT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    profiles: ["app"]

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: roadmap
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-roadmap}
      POSTGRES_DB: roadmap
    command:
      - postgres
      - -c
      - shared_buffers=32MB
      - -c
      - max_connections=20
      - -c
      - work_mem=2MB
      - -c
      - maintenance_work_mem=16MB
      - -c
      - effective_cache_size=64MB
    ports:
      - "5432:5432"
    volumes:
      - roadmap-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U roadmap -d roadmap"]
      interval: 10s
      timeout: 5s
      retries: 5
    mem_limit: 256m
    cpus: 0.5
    restart: unless-stopped

volumes:
  roadmap-db:
```

With the `app` profile the full stack starts via `docker compose --profile app up -d --build`; plain `docker compose up -d` keeps starting only Postgres for development.

- [ ] **Step 3: Write the Coolify compose file**

`docker-compose.coolify.yml`:

```yaml
# Deployment on Coolify from the GHCR image built by .github/workflows/image.yml.
# In Coolify: New Resource -> Docker Compose -> this file. Set POSTGRES_PASSWORD,
# BETTER_AUTH_SECRET, BETTER_AUTH_URL (the public https URL), DISCORD_CLIENT_ID and
# DISCORD_CLIENT_SECRET, and assign the domain to the "app" service on port 3000.
services:
  app:
    image: ghcr.io/slne-development/roadmap-app:latest
    environment:
      - SERVICE_FQDN_APP_3000
      - DATABASE_URL=postgres://roadmap:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}@postgres:5432/roadmap
      - BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET:?Set BETTER_AUTH_SECRET}
      - BETTER_AUTH_URL=${BETTER_AUTH_URL:?Set BETTER_AUTH_URL}
      - DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID:?Set DISCORD_CLIENT_ID}
      - DISCORD_CLIENT_SECRET=${DISCORD_CLIENT_SECRET:?Set DISCORD_CLIENT_SECRET}
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  postgres:
    image: postgres:17-alpine
    environment:
      - POSTGRES_USER=roadmap
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
      - POSTGRES_DB=roadmap
    command:
      - postgres
      - -c
      - shared_buffers=32MB
      - -c
      - max_connections=20
      - -c
      - work_mem=2MB
      - -c
      - maintenance_work_mem=16MB
      - -c
      - effective_cache_size=64MB
    volumes:
      - roadmap-db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U roadmap -d roadmap"]
      interval: 10s
      timeout: 5s
      retries: 5
    mem_limit: 256m
    cpus: 0.5
    restart: unless-stopped

volumes:
  roadmap-db:
```

- [ ] **Step 4: Build and run the image locally**

```bash
docker compose --profile app up -d --build
docker compose ps
curl -s http://localhost:3000/api/health
docker stats --no-stream
```

Expected: both services healthy, `{"ok":true}`, and the `postgres` container's memory limit shows `256MiB`. The app logs show no migration errors (`docker compose logs app | tail -20`). Then `docker compose --profile app down` (keep the volume).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore docker-compose.yml docker-compose.coolify.yml
git commit -m "build: Add the production image and compose files with a lean Postgres"
```

---

### Task 8.2: GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/image.yml`

- [ ] **Step 1: Write the workflows**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run test:plugin
      - run: npm run build
```

`.github/workflows/image.yml`:

```yaml
name: Image

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  packages: write

jobs:
  image:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/slne-development/roadmap-app
          tags: |
            type=raw,value=latest
            type=sha,prefix=sha-
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Commit**

```bash
git add .github
git commit -m "ci: Add checks and the GHCR image workflow"
```

---

### Task 8.3: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write the README**

`README.md`:

````markdown
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

## Deploy on Coolify

`.github/workflows/image.yml` publishes `ghcr.io/slne-development/roadmap-app`
(`latest`, `sha-<commit>`) on every push to `main`.

1. In Coolify, create a Docker Compose resource from `docker-compose.coolify.yml`.
2. Set `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
   `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
3. Assign the domain to the `app` service on port 3000.
4. Add `https://<domain>/api/auth/callback/discord` as a redirect in the Discord application.

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
````

- [ ] **Step 2: Final verification**

```bash
npm ci && npm run lint && npm run typecheck && npm test && npm run test:plugin && npm run build
git status --short
```

Expected: every check passes and the tree is clean apart from the README.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: Add the README"
```

- [ ] **Step 4: Hand over to the user (do not push on your own)**

Tell the user, in one message:
1. Everything is committed locally on `main`; ask whether to push to `origin` (`git@github.com:SLNE-Development/roadmap-app.git`). Push only on a yes.
2. After the first push, `image.yml` publishes the image to GHCR as a private package; ask them to make `roadmap-app` public (and the repository, since the plugin is installed from it) when they are ready.
3. The Coolify steps from the README, and the Discord redirect for the production domain.
4. `S:\Workspaces\surf-roleplay\roadmap-app` is untouched; replacing it (and switching surf-roleplay to the plugin) is a separate task.
