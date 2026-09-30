# roadmap-app v2 Part 7: GitHub App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect projects to GitHub. An admin creates and installs one GitHub App per instance, project owners link repositories through a searchable picker (or by hand, as a plain webhook, for repos the app can't see), and pull requests and commits that mention roadmap tasks or systems link to them. Owners can turn on rules: a merged PR closes its tasks, an opened PR moves the system to review, and failing checks warn. Column gates gain "open PR" and "merged PR" rules.

**Architecture:** GitHub calls go through one narrow interface, `GitHubApi` (`src/lib/github/api.ts`). It is backed by `@octokit/app` in production and by `fakeGitHubApi()` in tests. Two webhook routes (`/api/github/app` for the app, `/api/github/hooks/[repoId]` for hand-added repos) check the signature, record the delivery for dedupe and health, and enqueue one `github.event` job on `QUEUE.github`. They do nothing else. Worker handlers in `src/worker/github/*` update installations, parse references, upsert `code_link` rows and run the owner rules through the existing ops (`updateTask`, `moveSystem`), acting as the PR author or the owner who linked the repo, with agent label `GitHub`. Secrets are stored encrypted with the Part 6 crypto helper.

**Tech Stack:** Part 1 queue, worker and Kv; Part 4 gate rule registry; Part 6 `notify` and `src/lib/crypto.ts`; `@octokit/app` (app JWTs and installation tokens) and `@octokit/request`. Check both with `npm view @octokit/app version` and `npm view @octokit/request version`, pin with `^`, and read the installed README for the exact constructor options before Task 7.2. Signatures use Node's `crypto` (no extra package).

**Spec:** none (plans only; see `2026-10-01-roadmap-v2-index.md`). This part implements the "GitHub App" proposal of the review artifact: an admin page to create and install the app, a project repo picker with a manual fallback, code links, owner rules and PR gate rules.

**Assumes done:**
- **Part 1:** `QUEUE`, `bullQueue`, `memoryQueue`, `registerJob`, `WorkerDeps`, `Kv` / `memoryKv`, the `maintenance` queue with repeatable jobs.
- **Part 4:** `registerGateRule` and the `GateRule` type in `src/lib/ops/gates.ts`.
- **Part 6:** `notify(tx, input)` in `src/lib/ops/notifications.ts` with its recipient filter, and `encryptSecret(plain: string): string` / `decryptSecret(value: string): string` in `src/lib/crypto.ts` (keyed by `ENCRYPTION_KEY`).

If a name there differs, use the real one and note it in the task's commit body.

## Global Constraints

Everything in the Global Constraints of `2026-10-01-roadmap-v2-index.md` holds. In particular:

- One task, one commit, Conventional Commits `type(scope): lowercase description`, scope `github` unless stated, ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never push.
- Business logic in `src/lib/ops/github*.ts`, taking `(db, actor, …)` with zod inputs exported as `<name>Input`, writes in one transaction with `logChange`.
- Web routes never call GitHub for webhook handling; they verify, record and enqueue. Admin and settings actions that need GitHub answers (manifest conversion, installation lookup, repo list) may call `GitHubApi` directly, because the person is waiting for that answer.
- Tests never hit the network: they pass `fakeGitHubApi()` and `memoryQueue()` / `memoryKv()`.
- UI in shadcn/ui + Tide tokens; add `command` and `popover` usage for the combobox (both already installed), `npx shadcn@latest add badge` only if a badge is needed and missing.
- New change-log entities introduced by this part: `repo` (fields `created`, `deleted`, `rules`) and `code` (field `created`, `state`, `checks`). Automated writes carry `agent: "GitHub"`.
- Permissions: the GitHub App is admin-only. Linking repos to a project is for project owners when the link policy is `owners` (default), or admins only when it is `admins`. Code links are visible to anyone who can see the project.
- GitHub API base `https://api.github.com`, web base `https://github.com`. No GitHub Enterprise support in this part.

## Review Focus

1. **A forged, missing or stale signature on either webhook route** (wrong secret, `sha1=` header, truncated hex, secret rotated more than 10 minutes ago): 401, no `github_delivery` row, nothing enqueued. Pinned in Task 7.3.
2. **The same delivery arriving twice** (GitHub redelivery, or two app instances receiving it): processed once. The second request answers 202 and enqueues nothing. Pinned in Task 7.3.
3. **A PR in repo A mentioning `roadmap#188` when task 188 belongs to a project that repo A is not linked to:** no link, no task change, and nothing about that task appears in the delivery error. Pinned in Task 7.6.
4. **Automation with nobody to act as** (PR author has no linked roadmap account and the owner who linked the repo was removed or demoted to viewer): the rule is skipped, the delivery records `skipped: no one to act as`, and nothing is written as a user who lacks the role. Pinned in Task 7.7.
5. **An owner in project P opening the repo picker while a repo is linked to project Q they can't see:** the repo shows as "linked to another project" without Q's name. Pinned in Task 7.5.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/db/schema/github.ts` | Tables `github_app`, `github_installation`, `github_install_request`, `github_repo`, `github_delivery`, `code_link`, `github_account`; exported from `src/db/schema/index.ts` |
| `src/lib/github/api.ts` | `GitHubApi` interface, `octokitGitHubApi(config)` production implementation |
| `src/lib/github/fake.ts` | `fakeGitHubApi(seed)` for tests (in `src/lib/github/`, imported only by tests) |
| `src/lib/github/signature.ts` | `signBody`, `verifySignature` |
| `src/lib/github/refs.ts` | `parseRefs(text)` |
| `src/lib/github/manifest.ts` | `buildManifest(baseUrl)`, `manifestActionUrl(org?)` |
| `src/lib/github/urls.ts` | `installUrl`, `installationManageUrl`, webhook URL builders |
| `src/lib/ops/github-app.ts` | Admin ops: credentials, installations, install requests, health, secret rotation, link policy |
| `src/lib/ops/github-repos.ts` | Project ops: available repos, link and unlink, rules, reveal manual secret |
| `src/lib/ops/github-links.ts` | Code links: upsert and list, per-system summary, gate checks |
| `src/lib/ops/github-accounts.ts` | Link and unlink a person's GitHub login |
| `src/worker/github/events.ts` | `github.event` job: dispatch by event name |
| `src/worker/github/installations.ts` | `installation` and `installation_repositories` handlers |
| `src/worker/github/pulls.ts` | `pull_request` and `push` handlers |
| `src/worker/github/checks.ts` | `check_suite` handler and check aggregation |
| `src/worker/github/rules.ts` | Automation actor and the three owner rules |
| `src/app/api/github/app/route.ts` | App webhook |
| `src/app/api/github/hooks/[repoId]/route.ts` | Manual repo webhook |
| `src/app/api/github/manifest/callback/route.ts` | Manifest flow return |
| `src/app/api/github/setup/route.ts` | Installation setup return |
| `src/app/api/github/oauth/callback/route.ts` | Personal GitHub login linking |
| `src/server/trpc/routers/github.ts` | `github` router (admin, project, account procedures) |
| `src/app/(app)/(global)/admin/github/page.tsx`, `github-admin-view.tsx` | Admin → GitHub App |
| `src/app/(app)/p/[project]/settings/github/page.tsx`, `github-settings-view.tsx` | Project settings → GitHub |
| `src/components/github/repo-picker.tsx` | Searchable repo combobox |
| `src/components/github/code-links.tsx` | PR and commit rows on the system page |
| `src/app/(app)/(global)/settings/connections/page.tsx`, `connections-view.tsx` | Personal GitHub login |

---

### Task 7.1: Schema and app credentials

**Files:**
- Create: `src/db/schema/github.ts`
- Modify: `src/db/schema/index.ts` (re-export)
- Create: `src/lib/ops/github-app.ts` (credentials part only)
- Test: `src/lib/ops/github-app.test.ts`
- Generated: `drizzle/00NN_github.sql` via `npm run db:generate -- --name github`

**Interfaces:**
- Consumes: `encryptSecret`, `decryptSecret` (Part 6); `newId()`; `Actor`.
- Produces:
  - Tables and row types `GitHubAppRow`, `GitHubInstallationRow`, `GitHubRepoRow`, `CodeLinkRow`, `GitHubAccountRow` (drizzle `$inferSelect`).
  - `saveAppCredentials(db, actor, raw: z.input<typeof appCredentialsInput>): Promise<void>`
  - `appCredentialsInput`
  - `loadAppConfig(db): Promise<GitHubAppConfig | null>`
  - `GitHubAppConfig = { appId: number; slug: string; name: string; ownerLogin: string; htmlUrl: string; clientId: string; clientSecret: string; privateKey: string; webhookSecret: string; previousWebhookSecret: string | null; previousSecretExpiresAt: Date | null; linkPolicy: "owners" | "admins" }`
  - `getAppSummary(db, actor): Promise<AppSummary | null>`: everything except the secrets. Admin only.

**Tables** (all timestamps `timestamptz` via the existing `tz` helper; column names snake_case in SQL, camelCase in TS):

- `github_app`: the single configured app for this instance.
  - `id` text primary key, always `"default"`
  - `app_id` integer not null
  - `slug` text not null
  - `name` text not null
  - `owner_login` text not null
  - `html_url` text not null
  - `client_id` text not null
  - `client_secret_enc` text not null
  - `private_key_enc` text not null
  - `webhook_secret_enc` text not null
  - `previous_webhook_secret_enc` text null
  - `previous_secret_expires_at` null
  - `link_policy` text enum `owners` | `admins`, default `owners`
  - `created_by` text references `user.id` on delete set null
  - `created_at`, `updated_at` default now
- `github_installation`: one row per GitHub installation of the app.
  - `id` bigint primary key: GitHub's installation id (use `bigint("id", { mode: "number" })`)
  - `account_login` text not null
  - `account_type` text enum `User` | `Organization`
  - `repository_selection` text enum `all` | `selected`
  - `repo_count` integer null
  - `status` text enum `active` | `suspended` | `removed`, default `active`
  - `installed_by_user_id` text null references `user.id` set null
  - `created_at`, `updated_at`
- `github_install_request`: an install that is waiting for an org owner's approval.
  - `id` text primary key
  - `requested_by_user_id` text references `user.id` on delete cascade
  - `requested_at` default now
  - `dismissed_at` null
- `github_repo`: a repository linked to a project.
  - `id` text primary key (`newId()`; also the path segment of the manual webhook URL)
  - `project_id` text not null references `project.id` on delete cascade
  - `full_name` text not null: as GitHub spells it, e.g. `SLNE-Development/surf`
  - `full_name_key` text not null unique: `full_name` lower-cased; one repo links to at most one project
  - `github_repo_id` bigint null (app mode only)
  - `installation_id` bigint null references `github_installation.id` on delete set null
  - `mode` text enum `app` | `webhook`
  - `access` text enum `ok` | `lost`, default `ok`
  - `private` boolean null
  - `webhook_secret_enc` text null (webhook mode only)
  - `rules` jsonb not null, default `{"closeOnMerge":false,"reviewOnOpen":false,"checksWarning":false}`
  - `last_event_at` null
  - `created_by` text null references `user.id` set null
  - `created_at`
- `github_delivery`: every webhook delivery received, for dedupe and health.
  - `delivery_id` text primary key: `X-GitHub-Delivery`
  - `source` text enum `app` | `repo`
  - `event` text not null
  - `repo_id` text null references `github_repo.id` on delete set null
  - `status` text enum `queued` | `done` | `ignored` | `skipped` | `failed`, default `queued`
  - `detail` text null
  - `received_at` default now
  - Index `github_delivery_received_idx` on (`received_at`).
- `code_link`: a PR or commit linked to a task or system.
  - `id` text primary key
  - `project_id` text not null references `project.id` cascade
  - `system_id` text not null references `system.id` cascade
  - `task_id` integer null references `task.id` cascade
  - `repo_id` text not null references `github_repo.id` cascade
  - `kind` text enum `pr` | `commit`
  - `ref_key` text not null: `pr:<number>` or `commit:<sha>`
  - `target_key` text not null: `task:<id>` or `system:<systemId>`
  - `number` integer null
  - `sha` text null (commit sha, or the PR's head sha)
  - `title` text not null
  - `url` text not null
  - `state` text enum `open` | `closed` | `merged` (PRs; commits use `merged`)
  - `checks` text enum `pending` | `success` | `failure`, null
  - `closes` boolean not null default false: the reference was in the PR title
  - `author_login` text null
  - `created_at`, `updated_at`
  - Unique `code_link_ref` on (`repo_id`, `ref_key`, `target_key`); index on (`system_id`); index on (`repo_id`, `sha`).
- `github_account`: a person's linked GitHub login.
  - `user_id` text primary key references `user.id` cascade
  - `github_id` bigint not null unique
  - `login` text not null
  - `linked_at` default now

**Behaviour:**
- `appCredentialsInput`: `appId` positive int; `slug` matching `^[a-z0-9][a-z0-9-]{0,99}$`; `name`, `ownerLogin` and `htmlUrl` non-empty strings, `htmlUrl` must start with `https://github.com/`; `clientId`, `clientSecret` and `webhookSecret` non-empty, at most 200 chars; `privateKey` must contain `-----BEGIN` and `PRIVATE KEY-----`.
- `saveAppCredentials`:
  - Admin only (`ForbiddenError` "Only admins can configure the GitHub App.").
  - Upserts the `default` row and encrypts the four secrets.
  - Keeps `link_policy` when the row already exists.
  - Writes no `change_log` row, because change_log is per project. It logs `console.info("github app configured", appId)` instead.
- `loadAppConfig` decrypts. It returns `null` when there is no row. It has no actor, because only server code calls it.
- `getAppSummary` returns `{ appId, slug, name, ownerLogin, htmlUrl, linkPolicy, createdAt, createdByName }`. Non-admins get `ForbiddenError`.

- [ ] **Step 1: Write the failing tests** in `github-app.test.ts`:
  - An admin saves credentials. `loadAppConfig` returns the same `privateKey` and `webhookSecret`. The raw `github_app.private_key_enc` column is not equal to the plaintext and does not contain `PRIVATE KEY`.
  - A non-admin calling `saveAppCredentials` gets a `ForbiddenError`.
  - Saving twice leaves one row. The second save's `appId` wins, and a `linkPolicy` set to `admins` before the second save is still `admins`.
  - `privateKey: "hello"` fails with an `InvalidError` whose message names `privateKey`.
  - `getAppSummary` for an admin has no key named `privateKey`, `clientSecret` or `webhookSecret`.
- [ ] **Step 2:** Run `npx vitest run src/lib/ops/github-app.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Write `src/db/schema/github.ts` as specified, re-export it, run `npm run db:generate -- --name github`, and check that the SQL contains the unique index on `full_name_key` and `code_link_ref`. Implement the three ops.
- [ ] **Step 4:** Run the test file, then `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(github): add github schema and encrypted app credentials`

---

### Task 7.2: GitHubApi wrapper and fake

**Files:**
- Create: `src/lib/github/api.ts`, `src/lib/github/fake.ts`
- Test: `src/lib/github/api.test.ts`
- Modify: `package.json` (add `@octokit/app`, `@octokit/request`)

**Interfaces:**
- Consumes: `GitHubAppConfig` (7.1).
- Produces:
  - `interface GitHubApi` with these methods:
    - `convertManifest(code: string): Promise<ManifestConversion>`: `POST /app-manifests/{code}/conversions`, no auth. `ManifestConversion = { id: number; slug: string; name: string; ownerLogin: string; htmlUrl: string; clientId: string; clientSecret: string; webhookSecret: string; pem: string }`
    - `getInstallation(id: number): Promise<InstallationInfo | null>`: app JWT, `GET /app/installations/{id}`; 404 → `null`. `InstallationInfo = { id: number; accountLogin: string; accountType: "User" | "Organization"; repositorySelection: "all" | "selected"; suspended: boolean }`
    - `listInstallations(): Promise<InstallationInfo[]>`: app JWT, `GET /app/installations`, paginated
    - `listInstallationRepos(installationId: number): Promise<RepoInfo[]>`: installation token, `GET /installation/repositories?per_page=100`, all pages. `RepoInfo = { id: number; fullName: string; ownerLogin: string; private: boolean }`
    - `updateWebhookSecret(secret: string): Promise<void>`: app JWT, `PATCH /app/hook/config` with `{ secret }`
    - `listFailedDeliveries(since: Date): Promise<{ id: number; event: string; deliveredAt: Date; statusCode: number }[]>`: app JWT, `GET /app/hook/deliveries?per_page=100`; keep entries newer than `since` whose `status` is not `"OK"`; stop paging when older than `since`
    - `listCheckSuites(installationId: number, fullName: string, sha: string): Promise<{ status: string; conclusion: string | null }[]>`: installation token, `GET /repos/{owner}/{repo}/commits/{sha}/check-suites`
    - `exchangeOAuthCode(code: string): Promise<{ id: number; login: string }>`: `POST https://github.com/login/oauth/access_token` with the app's `client_id`/`client_secret`/`code` (Accept JSON), then `GET /user` with that token; the token is discarded
  - `octokitGitHubApi(config: GitHubAppConfig | null, fetchImpl?: typeof fetch): GitHubApi`: methods needing the app throw `ConflictError("The GitHub App is not set up yet.")` when `config` is `null`. `convertManifest` works without config.
  - `getGitHubApi(db): Promise<GitHubApi>`: `octokitGitHubApi(await loadAppConfig(db))`. Used by routes, ops callers and the worker.
  - `fakeGitHubApi(seed?: Partial<FakeSeed>): GitHubApi & { calls: { method: string; args: unknown[] }[]; seed: FakeSeed }`. The seed holds `installations: InstallationInfo[]`, `repos: Record<number, RepoInfo[]>`, `suites: Record<string, { status; conclusion }[]>` keyed `fullName@sha`, `conversion?`, `oauthUser?` and `failedDeliveries?`. Unknown lookups return `null` or `[]`, the same as the real API.

**Behaviour:** build the production implementation on `@octokit/app` (`new App({ appId, privateKey, oauth: { clientId, clientSecret }, Octokit: Octokit.defaults({ request: { fetch: fetchImpl } }) })`). Check the installed README for the exact option shape. Use `app.octokit.request` for JWT calls, `app.getInstallationOctokit(id)` for installation calls, and `app.octokit.paginate` for lists. `convertManifest` and the OAuth exchange use `@octokit/request` with `fetchImpl`.

- [ ] **Step 1: Write the failing tests**, passing a stub `fetchImpl` that records `url`, `method` and body and returns canned JSON:
  - `convertManifest("abc")` issues `POST https://api.github.com/app-manifests/abc/conversions` and maps `{ id: 7, slug: "roadmap-x", name, owner: { login: "SLNE-Development" }, html_url, client_id, client_secret, webhook_secret, pem }` to the camelCase `ManifestConversion`.
  - `listInstallationRepos(42)`: the stub returns 100 repos on page 1 with a `Link: <…page=2>; rel="next"` header and 3 on page 2. Result length is 103. Each item has `ownerLogin` split from `full_name`.
  - `getInstallation(9)` when the stub answers 404 returns `null`.
  - `octokitGitHubApi(null).listInstallations()` rejects with a `ConflictError`.
  - `fakeGitHubApi({ repos: { 42: [r1] } }).listInstallationRepos(42)` returns `[r1]` and records one call.
  - For the tests that need an app, generate a throwaway RSA key in the test with `crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })` exported as PKCS#8 PEM.
- [ ] **Step 2:** Run `npx vitest run src/lib/github/api.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Install with `npm install @octokit/app@^<latest> @octokit/request@^<latest>` (versions from `npm view`), then implement `api.ts` and `fake.ts`.
- [ ] **Step 4:** Run the tests, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(github): add github api wrapper with a test fake`

---

### Task 7.3: Webhook routes, signatures and deliveries

**Files:**
- Create: `src/lib/github/signature.ts`, `src/app/api/github/app/route.ts`, `src/app/api/github/hooks/[repoId]/route.ts`, `src/lib/github/webhook.ts` (shared handler)
- Modify: `src/worker/jobs.ts` registration list (the Part 1 place where job modules are imported)
- Create: `src/worker/github/events.ts` (dispatch skeleton, filled in by 7.5–7.7)
- Test: `src/lib/github/signature.test.ts`, `src/lib/github/webhook.test.ts`

**Interfaces:**
- Consumes: `loadAppConfig`, `github_repo`, `github_delivery`, `decryptSecret`, `JobQueue`, `QUEUE.github`.
- Produces:
  - `signBody(secret: string, body: string): string`: returns `sha256=<hex>`.
  - `verifySignature(secrets: string[], body: string, header: string | null): boolean`
  - `handleWebhook(deps: { db: Db; queue: JobQueue; now: () => Date }, request: Request, target: { source: "app" } | { source: "repo"; repoId: string }): Promise<Response>`
  - Job `github.event` on `QUEUE.github` with data `GitHubEventJob = { deliveryId: string; event: string; source: "app" | "repo"; repoId: string | null; payload: unknown }`.
  - `registerJob(QUEUE.github, "github.event", handleGitHubEvent)`, where `handleGitHubEvent(data, deps)` dispatches on `event` to handlers registered with `onGitHubEvent(event: string, handler: (job: GitHubEventJob, deps: WorkerDeps, api: GitHubApi) => Promise<DeliveryOutcome>)`. `DeliveryOutcome = { status: "done" | "ignored" | "skipped"; detail?: string }`. When a handler throws, the delivery status becomes `failed` with the error message cut to 500 chars, and the job rethrows so BullMQ retries it (3 attempts, exponential backoff 10 s, set when enqueuing).

**Behaviour of `handleWebhook`:**
1. It reads `request.text()`. A body over 5 MB (by `content-length` header or actual length) → 413, nothing written.
2. It picks the secrets:
   - For `app`: `loadAppConfig`; no app → 404 `{ error: "No GitHub App is configured." }`. The secrets are `[webhookSecret]`, plus `previousWebhookSecret` while `previousSecretExpiresAt > now()`.
   - For `repo`: load the `github_repo` row by `repoId`. Unknown id, `mode !== "webhook"`, or no secret → **401**, the same response as a bad signature, so ids can't be probed. Secrets are `[decryptSecret(webhookSecretEnc)]`.
3. `verifySignature(secrets, body, request.headers.get("x-hub-signature-256"))` false → 401 `{ error: "Invalid signature." }`, nothing written.
4. A missing `x-github-delivery` or `x-github-event` header → 400.
5. `event === "ping"`: update `last_event_at` for a repo target and answer 200 `{ ok: true }`. No delivery row, nothing enqueued.
6. It parses the JSON; invalid → 400. For `repo` targets, `payload.repository.full_name` lower-cased must equal `full_name_key`, else 400 `{ error: "This webhook belongs to another repository." }`, nothing enqueued.
7. It runs `insert into github_delivery … on conflict (delivery_id) do nothing returning delivery_id`. No row returned → 202 `{ duplicate: true }`, nothing enqueued.
8. It enqueues `github.event` with `jobId = deliveryId`, updates the repo's `last_event_at` (repo targets), and answers 202 `{ queued: true }`.

**`verifySignature`:**
- The header must match `^sha256=[0-9a-f]{64}$`. `sha1=` and uppercase hex are rejected.
- For each secret, compute the HMAC-SHA256 hex of the raw body and compare with `crypto.timingSafeEqual` on equal-length buffers. Return true on the first match.

**Routes:** both export `POST` only, plus `dynamic = "force-dynamic"`. `GET` answers 405 with `Allow: POST`. They call `handleWebhook({ db: getDb(), queue: bullQueue(QUEUE.github), now: () => new Date() }, request, target)`. `/api/` is already outside the proxy matcher (`src/proxy.ts`), so no session is required. Check this and leave `proxy.ts` unchanged.

**Maintenance:** register a repeatable job `github.prune-deliveries` on `QUEUE.maintenance`, daily. It deletes `github_delivery` rows older than 30 days.

- [ ] **Step 1: Write the failing tests.**
  - `signature.test.ts`:
    - `verifySignature(["s"], "{}", signBody("s", "{}"))` → true.
    - Wrong secret → false.
    - `null` header → false.
    - `"sha1=" + <40 hex>` → false.
    - `"sha256=" + <63 hex>` → false.
    - Header with uppercase hex of the correct digest → false.
    - Two secrets `["new", "old"]` with a body signed by `"old"` → true.
  - `webhook.test.ts` (PGlite, `memoryQueue()`, app credentials saved via 7.1 with webhook secret `whsec`, one repo in webhook mode with secret `repo-secret` and `full_name` `Org/Repo`):
    1. App delivery with a valid signature → 202 `{ queued: true }`, one `github_delivery` row with status `queued`, and `queue.jobs` has one `github.event` with `jobId` equal to the delivery id.
    2. Same request again → 202 `{ duplicate: true }`, still one row and one job.
    3. Bad signature → 401, zero rows, zero jobs.
    4. Missing signature header → 401, zero rows, zero jobs.
    5. With `previous_webhook_secret_enc` set to the encrypted `old` and `previous_secret_expires_at` = now + 10 min (written directly in the test; rotation itself comes in 7.4), an app delivery signed with `old` 5 minutes later (fake `now`) → 202, and 11 minutes later → 401.
    6. Manual repo route with an unknown `repoId` → 401, and with a valid signature but `repository.full_name` `Other/Repo` → 400, zero jobs.
    7. `ping` → 200 and zero jobs.
    8. 6 MB body → 413.
    9. No app configured and an app delivery → 404.
- [ ] **Step 2:** Run both files. Expected: FAIL.
- [ ] **Step 3:** Implement `signature.ts`, `webhook.ts`, the two routes, the `events.ts` dispatcher with `onGitHubEvent` (it answers `{ status: "ignored" }` for events with no handler), the delivery status update after each job, and the prune job.
- [ ] **Step 4:** Run the tests, then `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(github): verify and queue github webhooks`

---

### Task 7.4: Admin → GitHub App

**Files:**
- Create: `src/lib/github/manifest.ts`, `src/lib/github/urls.ts`
- Modify: `src/lib/ops/github-app.ts` (installations, requests, health, rotation, policy)
- Create: `src/app/api/github/manifest/callback/route.ts`, `src/app/api/github/setup/route.ts`
- Create: `src/server/trpc/routers/github.ts` (admin procedures), register as `github` in `src/server/trpc/router.ts`
- Create: `src/app/(app)/(global)/admin/github/page.tsx`, `github-admin-view.tsx`
- Modify: `src/components/shell/user-area.tsx`: an admin-only menu item "GitHub App" (lucide `Github` icon, or `GitBranch` if the icon set lacks it) linking to `/admin/github`, directly below "Accounts"
- Test: `src/lib/github/manifest.test.ts`, `src/lib/ops/github-app.test.ts` (extend), `src/lib/github/setup.test.ts`

**Interfaces:**
- Consumes: 7.1, 7.2 (`GitHubApi`), `Kv`, `siteUrl()` from `src/lib/site.ts`.
- Produces:
  - `buildManifest(baseUrl: URL, name: string)`: the manifest object (below).
  - `manifestActionUrl(org: string | null, state: string): string`
  - `installUrl(slug: string, state: string): string`: `https://github.com/apps/<slug>/installations/new?state=<state>`
  - `installationManageUrl(i: { id: number; accountLogin: string; accountType: "User" | "Organization" }): string`: `https://github.com/settings/installations/<id>` for users, `https://github.com/organizations/<login>/settings/installations/<id>` for orgs.
  - `startManifest(db, kv, actor, raw: { org?: string | null }): Promise<{ action: string; manifest: string; state: string }>`: admin only. The state is a random 32-byte hex, stored as Kv `gh:manifest:<state>` → `actor.userId`, TTL 3600 s.
  - `completeManifest(db, kv, api, userId: string, code: string, state: string): Promise<void>`: the state must exist and map to `userId`, and the user must still be an admin, else `ForbiddenError`. It deletes the state, calls `api.convertManifest(code)`, and saves the credentials with `saveAppCredentials`.
  - `startInstall(db, kv, actor, raw: { returnTo?: string }): Promise<{ url: string }>`: any signed-in user. It needs the app (else `ConflictError`). State Kv `gh:install:<state>` → `{ userId, returnTo }`, TTL 3600 s. `returnTo` must start with `/` and not `//`; otherwise it is `/admin/github`.
  - `recordInstallation(db, kv, api, userId: string, raw: { installationId: number | null; setupAction: string | null; state: string | null }): Promise<string>`: returns the path to redirect to (details below).
  - `listInstallations(db, actor): Promise<InstallationView[]>`: admin only. `InstallationView = { id; accountLogin; accountType; repositorySelection; repoCount; status; installedByName: string | null; manageUrl; linkedRepoCount: number }`, active first, then by login.
  - `listInstallRequests(db, actor)`: admin only. Undismissed requests newer than 30 days, `{ id; requestedByName; requestedAt }`.
  - `dismissInstallRequest(db, actor, id)`
  - `appHealth(db, api, actor, now: Date): Promise<AppHealth>`: admin only. `AppHealth = { lastWebhookAt: Date | null; failedLast24h: number; recentErrors: { deliveryId; event; detail; receivedAt }[] }`. `failedLast24h` counts our own `github_delivery` rows with status `failed` in the last 24 h plus `api.listFailedDeliveries(now − 24 h)`. `recentErrors` holds our last 5 failed rows.
  - `rotateWebhookSecret(db, api, actor, now: Date): Promise<void>`: admin only. It generates 32 random bytes as hex, calls `api.updateWebhookSecret(new)` **first** (if that throws, nothing is stored), then stores `new` as `webhook_secret_enc`, the old secret as `previous_webhook_secret_enc`, and `previous_secret_expires_at = now + 10 min`.
  - `setLinkPolicy(db, actor, policy: "owners" | "admins")`: admin only.
  - The tRPC `github` router, admin procedures: `app` (query → `getAppSummary`), `health`, `installations`, `installRequests`, `startManifest`, `saveCredentials` (the paste form), `startInstall`, `dismissRequest`, `rotateSecret`, `setLinkPolicy`. Each non-admin call → FORBIDDEN, through the ops' `ForbiddenError`.

**Manifest** (exact keys):
- `name`: the form value, default `Roadmap (<host>)` with the host from `siteUrl()`, cut to 34 chars (GitHub's limit).
- `url`: `siteUrl().origin`
- `hook_attributes`: `{ url: <origin>/api/github/app, active: true }`
- `redirect_url`: `<origin>/api/github/manifest/callback`
- `callback_urls`: `[<origin>/api/github/oauth/callback]`
- `setup_url`: `<origin>/api/github/setup`
- `setup_on_update`: `true`
- `public`: `false`
- `request_oauth_on_install`: `false`
- `default_permissions`: `{ metadata: "read", contents: "read", pull_requests: "read", checks: "read" }`
- `default_events`: `["pull_request", "push", "check_suite"]`. `installation` and `installation_repositories` are always delivered to apps and must not be listed.

`manifestActionUrl(null, s)` = `https://github.com/settings/apps/new?state=<s>`; with an org = `https://github.com/organizations/<org>/settings/apps/new?state=<s>`. `org` must match `^[A-Za-z0-9-]{1,39}$`.

**Routes:**
- `GET /api/github/manifest/callback?code&state`:
  - Needs a session (`sessionActor()`), else redirect `/login`.
  - Calls `completeManifest`. On success → 303 to `/admin/github?created=1`. On `ForbiddenError` → 303 `/admin/github?error=state`. On a GitHub failure → 303 `/admin/github?error=github`, and logs it.
- `GET /api/github/setup?installation_id&setup_action&state`:
  - Needs a session.
  - Calls `recordInstallation` and 303s to the path it returns.
  - **Never trusts the query**: when `installationId` is present, it fetches `api.getInstallation(id)`. `null` → redirect `/admin/github?error=installation`. Otherwise it upserts `github_installation` from the API data, with `installed_by_user_id` set only on insert, and refreshes the Kv repo cache for it (delete `gh:repos:<id>`).
  - `setup_action=request` with no installation id → insert a `github_install_request` for the user, redirect `returnTo?requested=1`.
  - The state (when present and known) supplies `returnTo`. An unknown or missing state is allowed, because installs started on GitHub come without one; then the redirect is `/admin/github`.

**UI `/admin/github`** (`page.tsx` 404s for non-admins, like `admin/users/page.tsx`; prefetch `github.app`, then the others only when the app exists):
- **Not set up:** two cards.
  - "Create GitHub App": an optional org field ("Create under an organization (optional)"), an app name field with the default, and a primary button. The button calls `startManifest`, then builds a hidden `<form method="post" action={action}>` with one `<input name="manifest" value={manifest}>` and submits it.
  - "Use an existing app": fields app id, slug, name, owner, client id, client secret, private key (textarea), webhook secret; saves through `saveCredentials`. Under the form, the three URLs to configure on GitHub (webhook, setup, OAuth callback), each with a Copy button.
- **Set up:**
  - A header with the app name, app id, created by and date, and a "Connected" pill.
  - A stats row (installations, repos visible = sum of `repoCount`, time since the last webhook).
  - An "Installations" panel with the button "Install on an account or org ↗" (`startInstall`, then `window.location = url`), a row per installation (account, type, selection "All repos (n)" or "n selected repos", installed by, "Manage on GitHub ↗"), pending request rows with a "Dismiss" action, and a suspended or removed installation shown with a pill.
  - An "App settings" panel: permissions (static text), "Webhook secret · Rotated <date>" with a Rotate button behind a confirm dialog ("Rotate the webhook secret? GitHub switches to the new one right away; deliveries signed with the old one are accepted for 10 minutes."), "Who can link repos" as a `native-select` (Project owners / Admins only), and a "View on GitHub ↗" link to `htmlUrl`.
  - A "Health" panel with the last webhook, failed deliveries (24 h) and up to 5 recent errors.
  - A `?created=1` toast "GitHub App created. Install it on an account next." and `?error=…` toasts with a specific message each.

- [ ] **Step 1: Write the failing tests.**
  - `manifest.test.ts`: with base `https://roadmap.example.com`, `buildManifest` has `hook_attributes.url === "https://roadmap.example.com/api/github/app"`, `public === false`, `default_permissions` exactly as listed, and `default_events` without `installation`. `manifestActionUrl("SLNE-Development", "s")` is the org URL. `manifestActionUrl("bad/org", "s")` throws `InvalidError`. A name longer than 34 chars is cut to 34.
  - `github-app.test.ts` (extend):
    - `startManifest` by a non-admin → `ForbiddenError`.
    - `completeManifest` with an unknown state → `ForbiddenError` and no row.
    - A valid state and fake conversion → a `github_app` row, with the state deleted from Kv, so a second call with it → `ForbiddenError`.
    - `rotateWebhookSecret` when the fake's `updateWebhookSecret` throws → the stored secret is unchanged.
    - On success, the old secret is kept as previous with an expiry of now + 10 min.
    - `setLinkPolicy("admins")` then `getAppSummary().linkPolicy === "admins"`.
  - `setup.test.ts`:
    - `recordInstallation` with `installationId: 5` and a fake that knows installation 5 (org `SLNE-Development`, selected) → one active row with `installed_by_user_id` = user, and the redirect is `/admin/github`.
    - The same call with a state whose `returnTo` is `/p/demo/settings/github` → redirects there.
    - `installationId: 6` unknown to the fake → no row, and the redirect is `/admin/github?error=installation`.
    - `setupAction: "request"` without an id → one `github_install_request`, and the redirect ends with `requested=1`.
    - `returnTo: "//evil.com"` is replaced by `/admin/github`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the libs, ops, routes, router, page and menu item.
- [ ] **Step 4:** Run the tests, `npm test`, `npm run typecheck` and `npm run build`. Expected: PASS. Start `npm run dev`, open `/admin/github` as an admin, and check that the not-set-up state renders and that the existing-app form validates an empty private key.
- [ ] **Step 5: Commit:** `feat(github): add the admin github app page with manifest and install flows`

---

### Task 7.5: Installation events, repo picker and repo links

**Files:**
- Create: `src/worker/github/installations.ts`
- Create: `src/lib/ops/github-repos.ts`
- Modify: `src/server/trpc/routers/github.ts` (project procedures)
- Create: `src/components/github/repo-picker.tsx`
- Create: `src/app/(app)/p/[project]/settings/github/page.tsx`, `github-settings-view.tsx`
- Modify: `src/components/settings/settings-nav.tsx`: add `{ href: \`${base}/github\`, label: "GitHub", count: <linked repo count> }` after Boards; pass the count from `settings-frame.tsx` (from `github.repos` query length, or `null` while loading)
- Test: `src/worker/github/installations.test.ts`, `src/lib/ops/github-repos.test.ts`

**Interfaces:**
- Consumes: 7.1–7.4, `projectAccess`, `Kv`, `onGitHubEvent`.
- Produces:
  - `availableRepos(db, kv, api, actor, projectSlug): Promise<AvailableRepo[]>`: `AvailableRepo = { fullName; ownerLogin; private; installationId; githubRepoId; linked: null | { here: true } | { here: false; projectName: string | null } }`, sorted by owner then name. `projectName` is `null` when the actor can't see that project.
  - `listLinkedRepos(db, actor, projectSlug): Promise<LinkedRepoView[]>`: viewer+. `LinkedRepoView = { id; fullName; mode; access; private; rules; lastEventAt; createdByName }`.
  - `linkAppRepo(db, kv, api, actor, projectSlug, raw: { fullName: string }): Promise<LinkedRepoView>`
  - `linkManualRepo(db, actor, projectSlug, raw: { fullName: string }): Promise<{ repo: LinkedRepoView; webhookUrl: string; secret: string }>`
  - `revealRepoSecret(db, actor, repoId): Promise<{ webhookUrl: string; secret: string }>`
  - `unlinkRepo(db, actor, repoId)`
  - `setRepoRules(db, actor, repoId, raw: { closeOnMerge?: boolean; reviewOnOpen?: boolean; checksWarning?: boolean })`
  - `repoFullNameSchema`: `^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$`, which is also used by the manual form.
  - Kv cache: key `gh:repos:<installationId>`, JSON `RepoInfo[]`, TTL 300 s.
  - tRPC procedures: `repos` (linked, viewer+), `availableRepos`, `linkAppRepo`, `linkManualRepo`, `revealSecret`, `unlink`, `setRules`, `installMoreUrl` (→ `startInstall` with `returnTo` = the project's GitHub settings path).

**Who may link:** a project owner when the link policy is `owners`, or an admin (admins may link in any project they can see, even without being a member). Otherwise `ForbiddenError("Only admins can link repositories on this instance.")`. `listLinkedRepos` is viewer+.

**Behaviour:**
- `availableRepos`:
  - For each `active` installation, read the Kv cache or call `api.listInstallationRepos` and cache the result.
  - Join `github_repo` by `full_name_key`.
  - A repo linked in another project gets `projectName` only when `projectAccessById(actor, thatProjectId, "viewer")` succeeds; otherwise `null`.
  - Without an app → `[]`.
- `linkAppRepo`:
  - The repo must appear in `availableRepos` (fresh from the API when the cache misses it), else `InvalidError("The GitHub App can't see <fullName>. Install it on that repository first, or add it by hand.")`.
  - `full_name_key` taken → `ConflictError("<fullName> is already linked to another project.")`. Map the unique violation (`isUniqueViolation`), don't pre-check only.
  - Inserts with `mode: "app"`, `installation_id`, `github_repo_id`, `private`, and logs `repo`/`created` with `newValue: fullName`.
- `linkManualRepo`:
  - Parses `fullName`, generates a secret of 32 random bytes as hex, stores it encrypted, `mode: "webhook"`.
  - Returns `webhookUrl = <origin>/api/github/hooks/<id>` and the plain secret.
  - The same conflict rule applies.
  - If an app installation already sees that repo, it still links in webhook mode as asked, but the response carries `hint: "The GitHub App can see this repository; linking it through the app also shows checks."`.
- `revealRepoSecret`: webhook mode only (else `InvalidError`), same permission as linking.
- `unlinkRepo` deletes the row. `code_link` cascades. Logs `repo`/`deleted`.
- `setRepoRules` merges booleans into `rules` and logs `repo`/`rules` with old and new JSON.
- Worker handlers (registered with `onGitHubEvent`):
  - `installation`:
    - `created`, `unsuspend`, `new_permissions_accepted` → upsert from `payload.installation` (`id`, `account.login`, `account.type`, `repository_selection`), status `active`.
    - `suspend` → `suspended`.
    - `deleted` → `removed`, and every `github_repo` with that `installation_id` gets `access: "lost"`.
    - Clears `gh:repos:<id>`. Outcome `done`.
  - `installation_repositories`:
    - Clears `gh:repos:<id>` and updates `repository_selection`.
    - For `repositories_removed`, linked repos matching by `github_repo_id` get `access: "lost"`. For `repositories_added`, linked repos matching by `full_name_key` get `access: "ok"`, `installation_id` and `mode: "app"`, and their webhook secret is cleared, because the app now covers them.
    - Outcome `done`.

**UI `/p/[project]/settings/github`:**
- **No app configured:** an empty state "GitHub isn't set up on this instance. An admin can set it up under Admin → GitHub App." (with a link for admins), plus the manual form.
- **App configured:**
  - "Linked repositories" panel: one row per repo with the mono full name, "GitHub App · last event 3 min ago" or "Webhook only · …", pills `App` / `webhook` / `access lost`, the three rule switches (owner-only, `Switch`-like checkboxes labelled "Close tasks when a PR merges", "Move to review when a PR opens", "Warn when checks fail"; "Warn when checks fail" is disabled for webhook repos with the title "Needs the GitHub App"), and an Unlink action behind a confirm dialog.
  - `RepoPicker`: a `Popover` + `Command` combobox. `CommandInput` placeholder "Search repositories". Groups by `ownerLogin`, with a private or public pill per repo. Disabled items show "linked to <name>" or "linked to another project". Selecting links through `linkAppRepo`. The footer row reads "Not listed?" with "Install on more repos ↗" (`installMoreUrl`) and "Enter owner/repo by hand", which focuses the manual form.
  - "Add by hand" panel: the `owner/repo` input validated with `repoFullNameSchema` and a "Link repository" button. After linking it shows the payload URL and secret with Copy buttons, plus the instruction "Paste into the repository's Settings → Webhooks, content type application/json, events: pull requests and pushes." For an existing webhook repo, a "Show webhook settings" action calls `revealSecret`.
- The page is visible to viewers read-only (no picker, no switches).

- [ ] **Step 1: Write the failing tests.**
  - `installations.test.ts` (fake api, memoryKv):
    - `installation.created` for id 11 → an active row.
    - Then `installation.deleted` → status `removed`, and a linked app repo on 11 has `access === "lost"`.
    - `installation_repositories` added with a repo whose `full_name` matches a linked webhook repo → mode `app`, `webhook_secret_enc` null.
    - Kv `gh:repos:11` is gone after each event.
  - `github-repos.test.ts` (fake installation 11 sees `Org/a` and `Org/b`; projects P (owner O) and Q (owner O2; O is not a member)):
    - `availableRepos` for O lists both, `linked` null.
    - After O2 links `Org/b` in Q, O's `availableRepos` shows `Org/b` as `{ here: false, projectName: null }` (Review Focus 5). An admin member of Q sees `projectName: "Q"`.
    - `linkAppRepo(Org/b)` in P → `ConflictError` naming `Org/b`.
    - `linkAppRepo(Org/zzz)` → `InvalidError` with "can't see".
    - An editor linking → `ForbiddenError`.
    - With policy `admins`, owner O linking → `ForbiddenError`, and an admin → success.
    - `linkManualRepo("partner/docs")` returns a `webhookUrl` ending `/api/github/hooks/<id>`, the stored secret is encrypted, and `revealRepoSecret` returns the same secret.
    - `linkManualRepo("not a repo")` → `InvalidError`.
    - `setRepoRules({ closeOnMerge: true })` keeps the other two false and writes one `change_log` row with entity `repo`.
    - `availableRepos` twice calls `listInstallationRepos` once (cache).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the handlers, ops, procedures, picker, page and nav item.
- [ ] **Step 4:** Run the tests, `npm test`, `npm run typecheck` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(github): link repositories through the app picker or a manual webhook`

---

### Task 7.6: Reference parsing and code links

**Files:**
- Create: `src/lib/github/refs.ts`, `src/lib/ops/github-links.ts`, `src/worker/github/pulls.ts`
- Test: `src/lib/github/refs.test.ts`, `src/worker/github/pulls.test.ts`

**Interfaces:**
- Consumes: 7.1, 7.3 (`onGitHubEvent`), the `task` and `system` tables.
- Produces:
  - `parseRefs(text: string): { tasks: number[]; systems: string[] }`: unique, in first-seen order.
  - `upsertCodeLink(tx, input: CodeLinkInput): Promise<{ id: string; created: boolean; previous: CodeLinkRow | null }>`
  - `CodeLinkInput = { projectId; systemId; taskId: number | null; repoId; kind: "pr" | "commit"; number: number | null; sha: string | null; title; url; state; checks?: "pending" | "success" | "failure" | null; closes: boolean; authorLogin: string | null }`
  - `resolveRefs(tx, projectId, refs): Promise<{ tasks: { taskId: number; systemId: string }[]; systems: { systemId: string }[] }>`: only tasks and systems of that project; unknown ones are dropped silently.
  - `linksForSystem(db, actor, projectSlug, systemSlug): Promise<CodeLinkView[]>`: viewer+. `CodeLinkView = { kind; number; sha; title; url; state; checks; taskId; repoFullName; authorLogin; authorName: string | null; updatedAt }`, where `authorName` comes from `github_account` → `user.name`.

**Reference syntax** (bare `#188` is deliberately **not** a roadmap reference, because GitHub already uses it for issues and PRs in the same repo):
- Task: `roadmap#<id>`. Regex: `/(?<![\w/#-])roadmap#(\d{1,9})(?!\w)/gi`.
- System: `roadmap:<slug>`. Regex: `/(?<![\w/:-])roadmap:([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/gi`. The slug is lower-cased and must be at most 64 chars; longer ones are dropped.
- Both are case-insensitive for the `roadmap` prefix.

**Behaviour (worker handlers):**
- Finding the repo:
  - `app` source → the `github_repo` whose `github_repo_id === payload.repository.id`, else by `full_name_key`. No linked repo → outcome `ignored` with detail `repository not linked`.
  - `repo` source → the job's `repoId`.
  - Every lookup of tasks and systems is scoped to that repo's `project_id` (Review Focus 3).
- `pull_request` actions `opened`, `reopened`, `edited`, `synchronize`, `ready_for_review`, `closed`:
  - Refs from the title have `closes: true`. Refs only in the body have `closes: false`. A ref in both counts as the title.
  - `state`: `merged` if `pull_request.merged`, else `closed` if `state === "closed"`, else `open`.
  - `sha` is `pull_request.head.sha`.
  - `checks` is set to `pending` on `opened`/`synchronize` for app repos and stays null for webhook repos.
  - A task ref links with `target_key task:<id>` and the task's system. A system ref links with `target_key system:<systemId>`.
  - On `edited`, links whose ref was removed from both the title and body are deleted.
  - Each new link logs `code`/`created` (entity id = link id, `newValue: "PR #419"`), and each state change logs `code`/`state`, with the actor from 7.7's `automationActor`, or with no change log entry when there is no actor. The link is still stored in that case: code links aren't user actions.
  - Outcome `done`, with detail `"linked 2 tasks, 1 system"` or `"no roadmap references"`.
  - Runs 7.7's rules after linking; 7.6 adds a call to `runPullRequestRules(job, deps, api, links)` that is a no-op until 7.7.
- `push`:
  - For each of `payload.commits` (at most 100), parse `message`; links are `kind: "commit"`, `ref_key commit:<id>`, `state: "merged"`, `title` = the first line of the message cut to 200, `url` = `commit.url`, `closes: false`.
  - Deleted-branch pushes (`payload.deleted === true`) → `ignored`.

- [ ] **Step 1: Write the failing tests.**
  - `refs.test.ts`, as input → expected:
    - `"feat: search [roadmap#188 roadmap#189]"` → tasks `[188, 189]`
    - `"Roadmap#7 and roadmap#7"` → `[7]`
    - `"fixes #188"` → `[]`
    - `"see foo/roadmap#12"` → `[]`
    - `"xroadmap#3"` → `[]`
    - `"roadmap#1234567890"` (10 digits) → `[]`
    - `"roadmap:search-index."` → systems `["search-index"]`
    - `"roadmap:Search-Index"` → `["search-index"]`
    - `"roadmap:search--index"` → `[]`
    - `"roadmap:-x"` → `[]`
    - `"roadmap:" + "a".repeat(65)` → `[]`
    - `"https://x.com/roadmap:abc"` → `[]`
  - `pulls.test.ts` (project P with system `search-index` holding tasks t1 and t2; project Q with task q1; repo R linked to P in app mode):
    1. `pull_request.opened` titled `feat: results [roadmap#<t1>]` with body `also roadmap#<t2> roadmap:search-index` → three `code_link` rows: t1 `closes: true`, t2 `closes: false`, and a system link. State `open`, checks `pending`.
    2. The same PR with title `roadmap#<q1>` (a Q task) → no link, outcome detail `no roadmap references`, and nothing mentions q1 (Review Focus 3).
    3. `edited` removing `roadmap#<t2>` from the body → t2's link deleted, the others kept.
    4. `closed` with `merged: true` → t1 link `state: "merged"`.
    5. A delivery for an unlinked repo → `ignored`.
    6. `push` with two commits, one mentioning `roadmap#<t1>` → one commit link with `state "merged"` and the title as the message's first line.
    7. Running the same `opened` job twice leaves the same row count (idempotent upsert).
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the parser, the ops and the handlers.
- [ ] **Step 4:** Run the tests and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(github): link pull requests and commits that mention roadmap tasks`

---

### Task 7.7: Owner rules, checks and notifications

**Files:**
- Create: `src/worker/github/rules.ts`, `src/worker/github/checks.ts`
- Modify: `src/worker/github/pulls.ts` (call the rules)
- Modify: `src/lib/ops/notifications.ts`: append the kinds `pr.merged`, `checks.failed`, `automation.blocked` to Part 6's `NOTIFICATION_KINDS` and `DEFAULT_NOTIFY_RULES` (inbox on, push on for `checks.failed` and `automation.blocked`), with short English titles
- Test: `src/worker/github/rules.test.ts`, `src/worker/github/checks.test.ts`

**Interfaces:**
- Consumes: `updateTask`, `moveSystem`, `loadActor` (`src/lib/ops/users.ts`), `isMember` / project role lookup, `withAgent`, `notify`, `GitHubApi.listCheckSuites`.
- Produces:
  - `automationActor(db, repo: GitHubRepoRow, authorGithubId: number | null): Promise<Actor | null>`
  - `runPullRequestRules(job, deps, api, links): Promise<string[]>`: returns detail notes, e.g. `"closed task 188"`.
  - `aggregateChecks(suites: { status: string; conclusion: string | null }[]): "pending" | "success" | "failure"`

**Behaviour:**
- `automationActor`:
  1. If `authorGithubId` maps to a `github_account` whose user `loadActor` returns (still provisioned) and who is an `editor` or `owner` member of the repo's project → `withAgent(actor, "GitHub")`.
  2. Else the same test for `repo.createdBy`.
  3. Else `null` (Review Focus 4). Admins who aren't members are not used.
- Close on merge (`rules.closeOnMerge`, action `closed`, `merged: true`):
  - For each task link of this PR with `closes: true` whose task isn't `done`, call `updateTask(db, actor, taskId, { state: "done" })`.
  - With no actor → skip all, note `skipped: no one to act as`, and the delivery status is `skipped`.
- Review on open (`rules.reviewOnOpen`, actions `opened`, `ready_for_review`, and only when `pull_request.draft` is false):
  - For each distinct system linked by this PR whose current column category is `todo`, `active` or `blocked`, move it to the first column (lowest `sort_order`) with category `review` on its current board, through `moveSystem(db, actor, projectSlug, systemSlug, { column: column.id })`.
  - If the board has no review column → note `no review column on <board>`.
  - `ConflictError` (planning gate or a Part 4 column gate) → note `blocked: <message>`, and `notify` kind `automation.blocked` to the system owner with the message.
  - Systems already in `review` or `done` are left alone.
- Merged notification: whether or not the rule is on, a newly merged PR notifies the owners of its linked tasks (else the system owner) with kind `pr.merged`, title `PR #<n> merged: <title>`, href to the system page. Pass `sourceKey: "pr-merged:<repoId>:<n>"` to `notify`; its unique `notification_source_unique` index drops the duplicate.
- Checks (`check_suite` action `completed`, app repos only; a webhook repo delivery → `ignored`):
  - Find `code_link` rows with `repo_id = repo.id` and `sha = check_suite.head_sha`. None → `ignored`.
  - Call `api.listCheckSuites(repo.installationId, repo.fullName, sha)` and compute `aggregateChecks`:
    - Any suite whose status isn't `completed` → `pending`.
    - Else any conclusion in `failure`, `timed_out`, `cancelled`, `action_required`, `startup_failure` → `failure`.
    - Else `success` (`success`, `neutral` and `skipped` all count as passing).
    - An empty list → `pending`.
  - Update `checks` on those rows. Log `code`/`checks` when an actor exists.
  - A change to `failure` with `rules.checksWarning` → `notify` kind `checks.failed` to the system owner with `sourceKey: "checks-failed:<repoId>:<sha>"`.
- Notifications go through `notify`, so Part 6's recipient filter drops anyone who can't see the project.

- [ ] **Step 1: Write the failing tests.**
  - `rules.test.ts` (project P; repo R created by owner O; editor E has GitHub id 500; viewer V has GitHub id 600):
    1. Merged PR by author 500 with `roadmap#<t1>` in the title, `closeOnMerge` on → t1 `done`, and the change log author is E with agent `GitHub`.
    2. The same with author 999 (unlinked) → t1 `done`, attributed to O.
    3. Author 600 (viewer) and O demoted to viewer → t1 unchanged, delivery status `skipped`, detail contains `no one to act as` (Review Focus 4).
    4. A body-only ref (`closes: false`) → t1 unchanged.
    5. `closeOnMerge` off → t1 unchanged, but one `pr.merged` notification row for the task owner.
    6. `reviewOnOpen`: a system in an `active` column with planning complete → moved to the board's first review column. With planning incomplete → not moved, and one `automation.blocked` notification. A draft PR → not moved.
    7. Running the merged job twice → one `pr.merged` notification.
  - `checks.test.ts`:
    - `aggregateChecks([])` → `pending`.
    - `[{ status: "completed", conclusion: "success" }, { status: "in_progress", conclusion: null }]` → `pending`.
    - `[{ completed, "neutral" }, { completed, "skipped" }]` → `success`.
    - `[{ completed, "success" }, { completed, "timed_out" }]` → `failure`.
    - Handler: a PR link with head sha `abc` on app repo R and fake suites `R@abc` = one failure → the link's `checks` is `failure`, and one `checks.failed` notification when `checksWarning` is on and none when it's off.
    - A webhook-mode repo delivery → outcome `ignored`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `rules.ts` and `checks.ts`, wire the rules into `pulls.ts`, and add the notification kinds.
- [ ] **Step 4:** Run the tests and `npm test`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(github): close tasks on merge, move systems to review and track checks`

---

### Task 7.8: Code on the system page, gate rules and agent view

**Files:**
- Create: `src/components/github/code-links.tsx`
- Modify: `src/app/(app)/p/[project]/systems/[system]/system-view.tsx` (a "Code" panel on the overview tab, below tasks)
- Modify: `src/components/task-list.tsx` (a PR chip per task: `PR #419` with a state colour; checks `failure` shows a red dot with the title "Checks failing")
- Modify: `src/components/board-view.tsx` card (a small red "checks" marker when any of the system's open PR links has `checks: "failure"`, fed by a new optional `failingChecks: boolean` on the board card data from `listSystems`)
- Modify: `src/lib/ops/overview.ts` `getSystemOverview` (include `code: CodeLinkView[]`, newest first, at most 20) and `src/lib/ops/systems.ts` list query (`failingChecks`)
- Modify: `src/lib/tools/definitions.ts`: `get_system` output gains `code` entries `{ kind, number, title, state, checks, taskId, url }`, left out when `brief` (Part 5) is true
- Create: gate rule registration in `src/lib/ops/github-links.ts` (imported for its side effect by the module where Part 4 collects gate rules)
- Test: `src/lib/ops/github-links.test.ts`, extend `src/lib/ops/overview.test.ts`

**Interfaces:**
- Consumes: Part 4 `registerGateRule`, `GateRule`, 7.6 `linksForSystem`.
- Produces:
  - Gate rule `pr-open`: label "An open or merged pull request"; satisfied when the system has at least one `pr` link (direct or through one of its tasks) with state `open` or `merged`. Missing text: `no open or merged pull request`.
  - Gate rule `pr-merged`: label "A merged pull request"; satisfied when at least one such link has state `merged`. Missing text: `no merged pull request`.
  - Both rules are hidden from the column-rule picker when no app is configured **and** the project has no linked repos. The picker shows them with the note "needs a linked GitHub repository".

**UI "Code" panel:**
- A header "Code" with the right-hand text of the repo full name(s).
- One row per link: mono title, the line `#419 · <author name or login> · <relative time>`, and a pill per state (open = `cat-active`, merged = `cat-done`, closed = `cat-todo`), plus a checks pill (pending = `cat-review` "checks running", failure = `cat-blocked` "checks failing", success = hidden).
- Rows link to the GitHub URL (external, `rel="noreferrer"`).
- Empty state: "No pull requests or commits mention this system yet. Put roadmap#<task id> in a PR title to link it." plus, for owners, a link to project GitHub settings.

- [ ] **Step 1: Write the failing tests.**
  - `github-links.test.ts`:
    - A system with no links → the `pr-open` check fails with `no open or merged pull request`.
    - With an open PR linked through a task → `pr-open` passes and `pr-merged` fails.
    - After the link is merged → both pass.
    - A closed-not-merged PR → both fail.
    - `linksForSystem` for a viewer returns links with `authorName` resolved through `github_account`.
    - A non-member → `NotFoundError`.
  - `overview.test.ts`: `getSystemOverview(...).code` has length 2 after two links are inserted.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement the rules, overview and list fields, UI, and tool output.
- [ ] **Step 4:** Run the tests, `npm test` and `npm run build`. Expected: PASS. In `npm run dev`, insert a code link for a seeded system with SQL, open its page, and check that the Code panel and task chip render in light and dark themes.
- [ ] **Step 5: Commit:** `feat(github): show code links on systems and add pull request gate rules`

---

### Task 7.9: Personal GitHub login

**Files:**
- Create: `src/lib/ops/github-accounts.ts`, `src/app/api/github/oauth/callback/route.ts`
- Create: `src/app/(app)/(global)/settings/connections/page.tsx`, `connections-view.tsx`
- Modify: `src/server/trpc/routers/github.ts` (account procedures), `src/components/shell/user-area.tsx` (menu item "Connections" below "API keys", shown when the app is configured)
- Test: `src/lib/ops/github-accounts.test.ts`

**Interfaces:**
- Produces:
  - `startGitHubLink(db, kv, actor): Promise<{ url: string }>`: `https://github.com/login/oauth/authorize?client_id=<clientId>&state=<state>&allow_signup=false`. The state is Kv `gh:oauth:<state>` → userId, TTL 600 s. No app → `ConflictError`.
  - `completeGitHubLink(db, kv, api, userId, code, state)`: the state must map to `userId`. It calls `api.exchangeOAuthCode`, then upserts `github_account`.
  - `unlinkGitHub(db, actor)`
  - `myGitHubAccount(db, actor): Promise<{ login: string; linkedAt: Date } | null>`
  - Procedures `account` (query), `startLink`, `unlink`.

**Behaviour:**
- One GitHub id belongs to one roadmap user. Linking a `github_id` already linked to another user → `ConflictError("That GitHub account is linked to another person.")`.
- Relinking your own account updates `login`.
- The callback route needs a session. It redirects to `/settings/connections?linked=1`, or `?error=state` / `?error=taken` / `?error=github`.
- The page shows the linked login with an "Unlink" button, or a "Connect GitHub" button, with the explanation "Linking your GitHub account attributes your pull requests and merges to you on the roadmap."

- [ ] **Step 1: Write the failing tests.**
  - Complete with the fake `oauthUser: { id: 500, login: "rik-dev" }` → a row for the user.
  - A second user completing with the same GitHub id → `ConflictError`.
  - The first user relinking with login `rik` → the login updates.
  - Unknown state → `ForbiddenError`, no row.
  - `unlinkGitHub` removes the row.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests, `npm test` and `npm run build`. Expected: PASS.
- [ ] **Step 5: Commit:** `feat(github): let people link their github login for attribution`

---

### Task 7.10: Plugin, docs and environment

**Files:**
- Modify: `plugin/skills/finishing-a-development-branch/SKILL.md` ("Roadmap integration" section)
- Modify: `plugin/skills/using-surf-roadmap/SKILL.md` (one line on the reference syntax, if the skill lists conventions)
- Modify: `README.md` (a new "GitHub" section after "Agents: MCP and REST")
- Modify: `.env.example` (confirm `ENCRYPTION_KEY` is documented as also protecting GitHub credentials)
- Test: `plugin/scripts/scripts.test.mjs` only if a script changes; otherwise run `npm run test:plugin` unchanged

**Content:**
- The SKILL.md Roadmap integration gains a bullet: "When you open a pull request, end its title with the ids of the tasks the branch completes as `[roadmap#<id> roadmap#<id>]`, and put `roadmap:<system-slug>` in the body. Titles close tasks on merge when the project enables it; the body only links. Never use a bare `#<id>`, which GitHub reads as an issue." In Option 2, after "create the pull/merge request", add "(title and body per the Roadmap integration section)".
- README "GitHub":
  - An admin opens account menu → **GitHub App**, clicks **Create GitHub App**, confirms on GitHub, then **Install on an account or org** and picks repositories.
  - Owners link repositories under project settings → **GitHub**.
  - Repositories outside the app are added by hand, with a webhook URL and secret.
  - The reference syntax and the three rules.
  - The permissions the app requests (read-only).
  - `BETTER_AUTH_URL` must be the public origin, because the app's webhook and callback URLs are derived from it at creation time. Changing the domain later means updating the URLs in the app's settings on GitHub.

- [ ] **Step 1:** Edit the two skills and the README as specified.
- [ ] **Step 2:** Run `npm run test:plugin` and `npm run lint`. Expected: PASS.
- [ ] **Step 3: Commit:** `docs(github): document the github app and the pull request reference syntax`
