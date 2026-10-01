# roadmap-app v3: Event requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an event planner who has no developer skills file an event request (brief, date, images, answers to typed questions, a fallback plan, prep to-dos), let a developer accept it into a project (new or existing) with build progress visible to the planner, and let people post the event's Discord messages (team notice, announcement, reminder, disaster and resolved messages) with one click each. Nothing runs on its own: every post is a click, every reminder is only a notification, and the app never calls Claude.

**Architecture:** A **request** is its own entity (`event_request`) outside projects, owned by its requester. It links to at most one project and one system through nullable columns, and the project side shows a "Brief changed" banner by comparing the request's brief versions with the spec's recorded basis. Request history goes to its own `request_log` table, not to `change_log` (`change_log.project_id` is `NOT NULL`). Ops live in `src/lib/ops/requests*.ts`, taking `(db, actor, …)`; access is decided by `requestAccess` (Task 1) from the requester relation plus two per-user flags (`event_manager`, `event_developer`) and the admin flag. Discord work follows Part 6: web requests never call Discord. A button click runs an op that writes a **post record** (`event_post`, with one `parts` entry per Discord message) and enqueues one `events.post` job on `QUEUE.deliver`. The worker sends part by part with `?wait=true`, stores each message id right after its send, and can resume where it stopped. Edits and deletes go through the stored ids. Secrets (webhook URLs, bot token) are encrypted with `encryptSecret`, stored in a single `event_settings` row, decrypted only in the worker, and never leave the server in any form except the masked hint. Uploads live on a local Docker volume behind one access-checked route. Real Discord scheduled events use the bot token over REST (no gateway) from a worker job.

**Tech Stack:** as the v2 index. No new dependencies: `fetch`, `FormData`/`Blob` (Node 22) for Discord multipart, `node:fs/promises` and `node:crypto` for uploads. Reuses `bullmq` jobs, `notify`, `encryptSecret`/`decryptSecret`, `diffDocuments`/`unifiedDiff`, `QUEUE`, `memoryQueue`, `memoryKv`.

**Spec:** `docs/superpowers/specs/2026-10-01-event-requests-decisions.md` (binding; every decision in it is covered below). Read `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` first (Global Constraints, Shared names), and the Part 6 plan for `notify`, the worker's Discord job conventions and the crypto helper.

**Assumes done (use these exact names; if one differs in the repo, adapt and say so in the commit body):**
- Parts 0 to 8 as present on `feat/v2`: `projectAccess` / `projectAccessById`, `logChange`, `Actor`, `InvalidError` / `ForbiddenError` / `NotFoundError` / `ConflictError`, `newId`, `tz`, `entityId`, `createTestDb`, `insertUser`, `createProjectFixture`, `addMemberFixture` (`src/test/fixtures.ts`), `notify` and `NOTIFICATION_KINDS` (`src/lib/notification-kinds.ts`), `encryptSecret` / `decryptSecret` (`src/lib/crypto.ts`), `registerJob`, `registerRepeatable`, `WorkerDeps`, `QUEUE`, `memoryQueue`, `memoryKv`, `setAdmin` and `listAllowedAccounts` (`src/lib/ops/users.ts`), `writeSpec` / `writePlan` / `latestDocument` / `compareDocuments` (`src/lib/ops/documents.ts`), `createSystem`, `addQuestion`, `getProject`, `diffDocuments` / `unifiedDiff` (`src/lib/diff.ts`), `defineTool` / `register` (`src/lib/tools/registry.ts`), `TOOL_LIST_BUDGET_BYTES` / `toolListBytes` (`src/lib/mcp/tool-list.ts`), `INVALIDATES` (`src/trpc/invalidation.ts`), `buildDiscordBatches` / `plainMessage` (`src/lib/discord-format.ts`, reused for the 429 helper only), `siteUrl()`.
- Part 9 (live updates and German interface) is **not** done. UI copy is English literals; Discord post texts are German literals by decision. When Part 9 lands, it adds the `requests` router to its channel map (note in Task 2's commit body).

## Global Constraints

- All of the v2 index's Global Constraints apply, in particular:
  - **Ops layer rule:** business logic in `src/lib/ops/<area>.ts`, `(db: Db, actor: Actor, …)`, zod input exported as `<name>Input`, one `db.transaction` per write, access through the helpers of Task 1, history through `logRequest` (Task 2; the request counterpart of `logChange`, because requests have no project). Errors are `InvalidError`, `ForbiddenError`, `NotFoundError`, `ConflictError`.
  - **Adapters:** UI through tRPC routers in `src/server/trpc/routers/` registered in `router.ts`; agent features as tools in `src/lib/tools/definitions.ts` (only `ask_requester` and `get_request`, plus one optional input on `write_spec`).
  - **INVALIDATES:** the new `requests` router gets an entry in `src/trpc/invalidation.ts` (Task 2), and `tasks`, `systems` and `planning` entries gain `"requests"` (Task 7) so the progress bar refreshes.
  - **Tests** run on PGlite with `createTestDb()`. Queue, Kv and fetch are injected (`memoryQueue()`, `memoryKv()`, `vi.stubGlobal("fetch", …)`); the filesystem is a temp directory from `fs.mkdtemp` set through the env var of Task 4.
  - **Job ids contain no `:`** and are not purely numeric (`event-post-<postId>-<n>`, never `event-post:…`). Kv lock keys may contain `:`.
  - **Web requests never call Discord directly.** Every send, edit, delete, test send and Discord-event call is a job enqueued by the op behind the button click. The job re-checks everything it needs (it never trusts the click's payload beyond ids).
  - **Commits:** Conventional Commits in English, `type(scope): lowercase description`, scope `events` unless stated. End every commit message with the line `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. One task, one commit. Never push.
- **Nothing automatic.** No scheduled posts, no automatic server checks, no automatic status changes, no Claude calls. The only repeatable job (Task 15) creates **notifications**. Date-driven side effects are limited to what the decisions list (re-dating template to-dos, updating the Discord event and the project deadline when a person changes the event date).
- **German texts for Discord.** Every string the app writes into a Discord post (embed field names, fixed phrases such as "wieder online", test-send marker, details labels) is a German literal in `src/lib/event-messages.ts`. User-written and template text is posted as written.
- **Placeholders** (templates only; resolved by `fillPlaceholders` in Task 11): `{event}`, `{date}`, `{time}`, `{duration}`, `{docs}`, `{rules}`, `{where}`, `{note}` (resolved template only). An unknown placeholder stays as written; a known one without data becomes an empty string and the surrounding whitespace is collapsed.
- **Discord limits** (enforced by `src/lib/discord-limits.ts`, pure): message `content` 2,000 characters; all embeds of one message together 6,000 characters (title, description, field names and values, footer, author); at most 10 embeds and 25 fields per message; embed title 256, description 4,096, field name 256, field value 1,024, footer text 2,048. Lengths are counted in Unicode code points via `Array.from(text).length` and never split an emoji or surrogate pair.
- **`allowed_mentions` rules:** a post that may ping sends `{ parse: [], roles: [<pingRoleId>] }` on its **first message only** and only when `pingRole` is true; every other message, every edit (PATCH), every test send, every team message, every disaster/resolved message and every reply sends `{ parse: [] }`. The role mention text `<@&id>` is written into the content only for the one message that may ping. Test sends strip it.
- **Secrets:** webhook URLs and the bot token are admin-only to write, never returned by any procedure, tool or log line (only `…••••abcd` hints), never in `request_log`, `change_log`, job payloads or error messages (errors name the setting, not the URL).
- **Env var added by this part:** `EVENT_UPLOADS_DIR` (path inside the container for uploaded images, default `/data/uploads`, required to exist and be writable in `app` and `worker`). Added to `.env.example`, both compose files (a named volume `roadmap-uploads` mounted at that path in `app` **and** `worker`), the README table and the worker's start check.
- **UI:** shadcn/ui plus Tide tokens as the v2 index says; every control has an accessible name and a keyboard path; English literals.

## Review Focus

1. **A secret never reaches an event manager or the client.** Webhook URLs and the bot token are write-only for admins and masked to everyone else; no procedure, tool, log row, job payload or error carries them. Pinned in Task 10 (`getEventSettings` serialization test, manager `updateEventSettings` rejects secret keys) and Task 11 (error text test).
2. **A test send never creates a Discord event or pings.** It goes only to the staff test webhook, strips the role mention, sends `allowed_mentions: { parse: [] }`, and never calls the bot-token REST client. Pinned in Task 12.
3. **Editing a split post updates every stored part without pinging.** Each stored id is PATCHed with `allowed_mentions: { parse: [] }`; growing or shrinking the part count keeps the details embed as the last message and loses no id. Pinned in Task 12.
4. **A requester sees and edits only their own requests, an event manager sees all.** Developers see non-draft requests, linked-project members see their request's non-draft summary, nobody else sees anything (404, not 403). Pinned in Task 1 (`requestAccess` matrix test) and Task 2.
5. **A failed mid-post send leaves a resumable record and never double-posts.** Each part's message id is stored the moment Discord answers; a retry or "Resume" sends only parts without an id; a posted part is never sent twice, and a 4xx rejection stops the post with a visible error instead of retrying forever. Pinned in Task 11.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/db/schema/events.ts` | All event tables (below), exported from `src/db/schema/index.ts` |
| `src/lib/ops/request-access.ts` | `eventFlags`, `requestAccess`, `requireEventManager`, `requireEventDeveloper`, `canAcceptRequests` |
| `src/lib/ops/requests.ts` | Request CRUD, status transitions, brief versions, `request_log` writes, list/get views |
| `src/lib/ops/request-notify.ts` | `notifyRequest` helpers wrapping `notify` for request events |
| `src/lib/event-status.ts` | `REQUEST_STATUSES`, allowed transitions (pure) |
| `src/lib/ops/uploads.ts` | Upload ops: store, read, delete, access checks |
| `src/lib/uploads.ts` | Limits, magic-byte sniffing, safe path building (pure) |
| `src/app/api/events/uploads/route.ts`, `src/app/api/events/uploads/[id]/route.ts` | Upload POST and serving GET |
| `src/lib/ops/request-questions.ts` | Question rounds, typed answers, validation |
| `src/lib/event-questions.ts` | `QUESTION_TYPES`, per-type config and answer schemas (pure, shared by ops, tools and UI) |
| `src/lib/ops/request-link.ts` | Accept: create project from request, link existing project, progress, brief basis |
| `src/lib/event-template.ts` | The "Event" project template (board, phases, domain) |
| `src/lib/ops/request-fallback.ts` | Fallback scenarios and the readiness gate |
| `src/lib/ops/request-prep.ts` | Prep to-dos (template and dates), event-day checklist, staff check-in |
| `src/lib/event-prep-template.ts` | `PREP_TEMPLATE`, `CHECKLIST_TEMPLATE`, `dueFor` (pure) |
| `src/lib/ops/event-settings.ts` | Settings read (masked) and write (managers) and secrets write (admins) |
| `src/lib/event-placeholders.ts` | `PLACEHOLDERS`, `fillPlaceholders`, `placeholderValues` (pure) |
| `src/lib/event-messages.ts` | German fixed strings, details embed builder, disaster/resolved embed builders (pure) |
| `src/lib/discord-limits.ts` | Limit constants, `splitText`, `fitsMessage`, `countEmbedChars` (pure) |
| `src/lib/ops/request-posts.ts` | Post records: draft, plan parts, start, resume, edit, delete, test send, disaster, resolve |
| `src/lib/discord-webhook.ts` | Thin `fetch` client: `sendMessage`, `editMessage`, `deleteMessage` with the shared result type and 429 handling |
| `src/lib/discord-bot.ts` | Thin bot-token REST client for scheduled events |
| `src/worker/jobs/events-post.ts` | `events.post`, `events.edit`, `events.delete`, `events.test` jobs |
| `src/worker/jobs/events-discord-event.ts` | `events.discord-event` job (create, update, delete) |
| `src/worker/jobs/events-reminders.ts` | `events.reminders` repeatable job |
| `src/lib/event-prompts.ts` | `buildPrompts` for the three copy prompts (pure) |
| `src/server/trpc/routers/requests.ts` | `requests` router (requests, questions, fallback, prep, posts, settings, prompts) |
| `src/lib/tools/definitions.ts`, `src/lib/tools/registry.test.ts`, `src/lib/mcp/tool-list.ts` | `ask_requester`, `get_request`, `write_spec.brief` |
| `src/app/(app)/(global)/requests/page.tsx` + `requests-view.tsx` | Requests list |
| `src/app/(app)/(global)/requests/[request]/page.tsx` + `request-view.tsx` and `components/events/*` | Request page: tabs Brief, Questions, Fallback, Prep, Event day, Messages |
| `src/app/(app)/(global)/requests/settings/page.tsx` + `event-settings-view.tsx` | Event settings |
| `src/components/events/*` | Question form renderer, status bar, progress bar, brief diff, copy-prompts dialog, post composer, checklist |
| `src/components/projects/brief-banner.tsx` | "Brief changed since spec vN" banner on the linked project |
| `plugin/commands/requests.md`, `plugin/skills/event-requests/SKILL.md`, `plugin/skills/plan-system/SKILL.md` | `/surf-roadmap:requests`, the skill, moderation planning area |
| `README.md`, `docs/event-requests.md` | Setup and user documentation |

**Tables** (all in `src/db/schema/events.ts`, snake_case SQL names, `tz` timestamps, ids `newId()` text unless noted; each task adds only its own tables and generates its own migration with `npm run db:generate -- --name <topic>`):

| Table | Added in |
| --- | --- |
| `user.is_event_manager`, `user.is_event_developer` (boolean not null default false) | Task 1 |
| `event_request`, `event_brief_version`, `request_log` | Task 1 |
| `event_upload` | Task 4 |
| `event_question`, `event_question_round` | Task 5 |
| `event_spec_basis`, `project.deadline` | Task 7 |
| `event_fallback`, `event_todo`, `event_checklist_item`, `event_checkin` | Task 9 |
| `event_settings` | Task 10 |
| `event_post` | Task 11 |

---

### Task 1: Event roles, request tables and the access rules

**Files:**
- Create: `src/db/schema/events.ts` (export from `src/db/schema/index.ts`), `src/lib/event-status.ts`, `src/lib/event-status.test.ts`
- Modify: `src/db/schema/auth.ts` (two user flags), `src/lib/ops/users.ts` (`setEventRole`, list output), `src/lib/ops/users.test.ts`, `src/test/fixtures.ts` (`insertUser` accepts `isEventManager`, `isEventDeveloper`; add `requestFixture`), the admin users view and router (two switches per user)
- Create: `src/lib/ops/request-access.ts`, `src/lib/ops/request-access.test.ts`
- Generated: `drizzle/00NN_event-requests.sql` via `npm run db:generate -- --name event-requests`

**Interfaces:**
- Produces:
  - `user.isEventManager`, `user.isEventDeveloper`. `AllowedAccountRow` gains `isEventManager`, `isEventDeveloper` (false when the user never signed in).
  - `setEventRole(db, actor, userId: string, role: "manager" | "developer", value: boolean): Promise<void>`: admin only (`ForbiddenError("Only admins can manage accounts.")`), `NotFoundError` for an unknown or de-provisioned user, idempotent.
  - `REQUEST_STATUSES = ["draft", "submitted", "accepted", "event_week", "done", "withdrawn", "cancelled"] as const`, `type RequestStatus`.
  - `canTransition(from: RequestStatus, to: RequestStatus): boolean` with exactly these edges: `draft→submitted`, `draft→withdrawn`, `submitted→accepted`, `submitted→withdrawn`, `submitted→draft` (recall), `accepted→event_week`, `accepted→cancelled`, `event_week→done`, `event_week→cancelled`. Everything else is false. `isOpen(status)` is true for `draft`, `submitted`, `accepted`, `event_week`.
  - Table `event_request`:
    - `id` text pk
    - `requesterId` text FK `user.id` on delete set null (a removed requester leaves the request visible to managers)
    - `title` text not null (1–120)
    - `status` text enum `REQUEST_STATUSES` not null default `draft`
    - `startsAt` timestamptz null, `durationMinutes` integer null (5–1440)
    - `where` text not null default `""` (where the event takes place: a world, server or area; max 200)
    - `eventDocsUrl` text null (https URL)
    - `briefVersion` integer not null default 1 (the current version number)
    - `projectId` text null FK `project.id` on delete set null; `systemId` text null FK `system.id` on delete set null
    - `discordEventId` text null (Task 13), `bannerUploadId` text null (Task 4, FK added there)
    - `submittedAt`, `acceptedAt` timestamptz null; `acceptedBy` text FK user set null
    - `createdAt`, `updatedAt` default now
    - Indexes on (`requesterId`, `status`), (`status`, `startsAt`), unique on `projectId` where not null is **not** wanted: several requests may link to one project, so a plain index on `projectId`.
  - Table `event_brief_version`: `requestId` FK cascade, `version` integer, `body` text not null (1–50,000), `authorUserId` FK user set null, `createdAt`; primary key (`requestId`, `version`).
  - Table `request_log`: `id` bigserial pk, `requestId` FK cascade, `field` text not null (`created`, `status`, `title`, `startsAt`, `durationMinutes`, `where`, `eventDocsUrl`, `brief`, `project`, `fallback`, `todo`, `post`, `settings`, …), `oldValue` text null, `newValue` text null, `authorUserId` FK set null, `agent` text null, `createdAt`; index on (`requestId`, `id`). Never stores secrets or webhook URLs.
  - `EventFlags = { isAdmin: boolean; isEventManager: boolean; isEventDeveloper: boolean }`, `eventFlags(db: Executor, actor: Actor): Promise<EventFlags>` (admin flag from the actor, the two flags read from `user`).
  - `RequestAccess = { request: EventRequestRow; role: "requester" | "manager" | "developer" | "project" | "staff"; flags: EventFlags; canEdit: boolean }`.
  - `requestAccess(db, actor, requestId: string, need: "view" | "edit" | "manage" | "develop"): Promise<RequestAccess>`:
    - `NotFoundError("Unknown request <id>.")` when the actor may not even view it (never 403 for visibility).
    - View rule: the requester; any event manager; any admin; any event developer or linked-project member (viewer or higher) **when status is not `draft`**.
    - `edit`: the requester while the request is open, or an event manager or admin (open or not). A non-requester with view-only gets `ForbiddenError("This needs …")`.
    - `manage`: event manager or admin (status moves such as cancel, reassigning the requester).
    - `develop`: event developer or admin, or an editor-or-higher member of the linked project (used by accept, questions asked by agents, spec basis).
    - Archived linked project does not change request access.
  - `requireEventManager(flags)`, `requireEventDeveloper(flags)`, `canAcceptRequests(flags): boolean` (admin or event developer).
  - `requestFixture(db, requester, over?)` in `src/test/fixtures.ts`: inserts a `draft` request with a version-1 brief.

**Rules:**
- The first brief version is written with the request (Task 2). In this task the tables and access helper exist and `requestFixture` inserts rows directly.
- Admins always pass every rule. The two flags are independent of the admin flag and of project membership.
- A user whose account was removed from `allowed_account` cannot be an actor at all (existing `loadActor`), so no extra rule is needed.

- [ ] **Step 1: Write failing tests.**
  - `event-status.test.ts`: every edge of `canTransition` listed above is true; the full 7×7 matrix has exactly 9 true cells; `isOpen`.
  - `users.test.ts`: `setEventRole` by an admin flips the flag and is idempotent; by a non-admin `ForbiddenError`; unknown user `NotFoundError`; `listAllowedAccounts` shows the flags; removing the flag works.
  - `request-access.test.ts` (matrix, using `insertUser` with flags and `addMemberFixture`): requester R, other user U, event manager M, event developer D, admin A, project member P (viewer of the linked project), requester-removed case.
    - `view`: R, M, A pass on a `draft`; D and P get `NotFoundError` on a `draft`; D and P pass once `submitted`; U gets `NotFoundError` always.
    - `edit`: R passes on `submitted`, fails with `ForbiddenError` for a `done` request; M and A pass on `done`; D fails with `ForbiddenError`.
    - `manage`: only M and A.
    - `develop`: D, A, and an editor member of the linked project pass; a viewer member P fails with `ForbiddenError`; R fails.
    - A request whose `requesterId` is null (requester deleted) is visible to M.
- [ ] **Step 2: Run** `npx vitest run src/lib/event-status.test.ts src/lib/ops/users.test.ts src/lib/ops/request-access.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the schema (doc comment on every table and column group), `event-status.ts`, `setEventRole`, `request-access.ts`, the fixture. Generate the migration, then run `npm test` to prove it applies.
- [ ] **Step 4: Admin UI.** On the existing admin users page add two `Switch` controls per provisioned user, "Event manager" and "Event developer", calling a new `admin.setEventRole` procedure (admin only); add `admin` already invalidates `admin`. Router test: a non-admin gets `FORBIDDEN`.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(events): add event roles, request tables and access rules`.

### Task 2: Requests, status changes and brief versions

**Files:**
- Create: `src/lib/ops/requests.ts`, `src/lib/ops/requests.test.ts`
- Create: `src/server/trpc/routers/requests.ts` (register as `requests` in `router.ts`; tests in `src/server/trpc/router.test.ts`)
- Modify: `src/trpc/invalidation.ts` (`requests: ["requests", "notifications", "history"]`)
- Create: `src/app/(app)/(global)/requests/page.tsx` + `requests-view.tsx`, `src/app/(app)/(global)/requests/[request]/page.tsx` + `request-view.tsx` (tabs Brief and Overview only; later tasks add tabs), `src/components/events/status-bar.tsx`, `src/components/events/brief-history.tsx`; sidebar link "Requests" in `src/components/shell/app-sidebar.tsx` (visible to admins, event managers, event developers and anyone who owns a request)

**Interfaces:**
- Consumes: `requestAccess`, `canTransition`, `eventFlags`, `unifiedDiff`.
- Produces:
  - `logRequest(tx: Executor, actor: Actor, entry: { requestId: string; field: string; oldValue?: string | null; newValue?: string | null }): Promise<void>` (writes `request_log`; never receives secrets).
  - `createRequestInput`: `{ title: 1–120, startsAt?: Date | ISO string, durationMinutes?: 5–1440, where?: ≤200, eventDocsUrl?: https URL ≤500 | null, brief: string (≤50,000, may be empty for a draft), requesterId?: string }`.
  - `createRequest(db, actor, raw): Promise<EventRequestRow>`: needs `isEventManager || isAdmin` (`ForbiddenError("Only event managers can create requests.")`). `requesterId` defaults to the actor; setting someone else (a provisioned user) is allowed for managers and admins. Writes brief version 1 (even when empty), logs `created`.
  - `updateRequestInput` (all optional): `title`, `startsAt`, `durationMinutes`, `where`, `eventDocsUrl`, `requesterId` (manage only). `updateRequest(db, actor, requestId, raw)`: `edit` access; logs one `request_log` row per changed field; `startsAt` in the past is `InvalidError` on submit (not on draft edits). Changing `startsAt` or `durationMinutes` on a linked request also sets `project.deadline` of the linked project (column added in Task 7; until then skip) and enqueues nothing yet (Tasks 9 and 13 hook in through `onDateChanged`, a no-op stub exported here with signature `onDateChanged(tx, actor, request, before: { startsAt: Date | null; durationMinutes: number | null }): Promise<void>`).
  - `saveBriefInput = { body: string (≤50,000), baseVersion: number }`. `saveBrief(db, actor, requestId, raw): Promise<{ version: number; changed: boolean }>`: `edit` access; lock the request row `for update`; `ConflictError("The brief changed in the meantime. Reload and merge your edits.")` when `baseVersion !== request.briefVersion`; an identical body (after trim and `\r\n`→`\n`) saves nothing and returns `changed: false`; otherwise inserts `version + 1`, updates `briefVersion`, logs `brief` (`vN → vN+1`, no body in the log). Allowed in `draft`, `submitted`, `accepted`, `event_week`.
  - `getBrief(db, actor, requestId, version?)`, `listBriefVersions(db, actor, requestId)` → `{ version, authorName, createdAt }[]`, `compareBriefs(db, actor, requestId, from, to)` → `{ hunks, added, removed }` via `diffDocuments` (`InvalidError` unless `from < to`).
  - `submitRequest(db, actor, requestId)`: `edit` access; `draft→submitted`; needs title, `startsAt` in the future, non-empty brief (`InvalidError` listing what is missing); sets `submittedAt`; logs `status`; notifies via Task 3 (`request.submitted`; wired there).
  - `recallRequest` (`submitted→draft`), `withdrawRequest` (`draft|submitted→withdrawn`) for `edit` access; `cancelRequest(db, actor, requestId, reason)` (`accepted|event_week→cancelled`, `manage` or `develop`, `reason` 1–500 stored as the log `newValue`). `markDone` (`event_week→done`, `edit` access or manager). Every transition checks `canTransition` (`ConflictError("A <from> request cannot become <to>.")`). `accept` and `event_week` are in Tasks 7 and 9.
  - `listRequests(db, actor, filter: { status?: RequestStatus[]; mine?: boolean; scope?: "open" | "all" })`: managers and admins see all; developers see non-draft; everyone else sees only their own (including drafts). Each item: `{ id, title, status, startsAt, requesterName, projectSlug | null, briefVersion, waitingOnRequester: boolean }` (the last field is filled in Task 5; `false` until then). Sorted by `startsAt` ascending nulls last, open first.
  - `getRequest(db, actor, requestId): Promise<RequestDetail>`: the row, requester name, current brief body, `canEdit`, `role`.
  - `requestHistory(db, actor, requestId, limit?)`.
  - tRPC `requests`: `list`, `get`, `create`, `update`, `saveBrief`, `brief`, `briefVersions`, `compareBriefs`, `submit`, `recall`, `withdraw`, `cancel`, `markDone`, `history`.

**Rules:** the Brief tab is a plain markdown textarea with "Save new version" (shows a conflict message and a "Reload" button on `ConflictError`) and a version list with a compare view. Mutations on terminal states (`done`, `withdrawn`, `cancelled`) other than reading are `ConflictError` except for managers and admins editing text fields. A request page for an actor with view-only access renders read-only.

- [ ] **Step 1: Write failing op tests:**
  - A non-manager `createRequest` gets `ForbiddenError`; a manager's request has `briefVersion` 1 and one version row; creating on behalf of another user sets `requesterId`.
  - `saveBrief` with a changed body makes version 2; an identical body (with trailing newline difference) returns `changed: false` and no new row; a stale `baseVersion` gets `ConflictError`; two concurrent saves with the same `baseVersion` leave exactly one winner.
  - `compareBriefs` returns added/removed counts for a one-line change; `from >= to` is `InvalidError`.
  - `submitRequest` without a date lists "event date" in the message; with everything, status is `submitted` and `submittedAt` is set; submitting twice is `ConflictError`.
  - Transition matrix through the ops: recall, withdraw, cancel (needs a reason), `markDone` only from `event_week`.
  - A stranger's `getRequest` is `NotFoundError`; the requester's `listRequests` returns only their own including drafts; a developer's list excludes drafts; a manager's list contains all.
  - Each changed field writes one `request_log` row; unchanged fields write none.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/requests.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the ops and router; router tests: `requests.get` for a stranger is `NOT_FOUND`, `create` by a non-manager is `FORBIDDEN`, `saveBrief` conflict is `CONFLICT`.
- [ ] **Step 4: Build the pages.** List page with status chips (Draft, Submitted, Accepted, Event week, Done) and a "New request" button for managers/admins; request page with the status bar (the seven statuses as a stepper, terminal ones as a badge), title/date/duration/where/docs fields, the Brief tab, and the action buttons the actor may use (Submit, Recall, Withdraw, Cancel with a reason dialog, Mark done).
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(events): add event requests with status flow and brief versions`. Body: note that Part 9 must add the `requests` router to its realtime channel map.

### Task 3: Notifications for requests

**Files:**
- Modify: `src/db/schema/notifications.ts` (`notification.projectId` becomes nullable; add `requestId` text null FK `event_request.id` on delete cascade; check constraint: at least one of the two is set), `src/lib/notification-kinds.ts`, `src/lib/notify-rules-schema.ts` (`PUSH_BY_DEFAULT`), `src/components/notifications/rules-table.tsx` (`KIND_LABELS`), `src/worker/jobs/push.ts` (urgency), `src/lib/ops/notifications.ts` and its test
- Create: `src/lib/ops/request-notify.ts`, `src/lib/ops/request-notify.test.ts`
- Generated: `drizzle/00NN_request-notifications.sql` via `npm run db:generate -- --name request-notifications`

**Interfaces:**
- New kinds appended to `NOTIFICATION_KINDS`: `request.submitted`, `request.question`, `request.answered`, `request.brief_changed`, `request.waiting`, `request.pickup`, `request.todo_due`, `request.accepted`. Labels (rules table): "A request is submitted for review", "The team asks me a question on my request", "My question got an answer", "A request's brief changed", "A request waits for my answer", "A request still needs a developer", "A prep to-do is due", "My request was accepted". Default rules: inbox true for all; push true for `request.question`, `request.waiting`, `request.todo_due`, `request.accepted`, false for the rest. Push urgency `high` for `request.waiting` only.
- `notify` input gains `requestId?: string`; `projectId` becomes optional. Exactly one of `projectId` and `requestId` must be given (`InvalidError` otherwise). `href` for request notifications starts with `/requests/` (validation accepts `/p/` or `/requests/`).
- `canReceiveRequest(tx, userId, requestId): Promise<boolean>`: true when `requestAccess`'s view rule would pass for that user (reuse the pure part of Task 1's rule; do not duplicate it: export `canViewRequest(db, userId, requestId)` from `request-access.ts` and have `requestAccess` call it). `notify` uses `canReceive` for project notifications and `canReceiveRequest` for request ones, and `deliver`-time re-checks (the dispatcher and `push.send`) use the same split.
- `listNotifications`, `unreadCount` and `NotificationItem` handle request rows: the project columns become `projectSlug: string | null`, `projectName: string | null`, and the item gains `requestId: string | null` and `requestTitle: string | null` (left joins; the visibility filter uses `canViewRequest` semantics for request rows).
- `notifyRequest(tx, input: { requestId: string; kind: RequestNotificationKind; userIds: string[]; title: string; body?: string; sourceKey: string; actor: Actor | null }): Promise<number>`: calls `notify` per user (never the acting user, except `request.waiting` and `request.todo_due` reminders which have no actor), `href` is `/requests/<id>` (plus `?tab=<tab>` where given), returns the number inserted. Helpers: `developerIds(tx)` (admins and event developers, provisioned), `managerIds(tx)`, `requesterIdOf(request)`.
- Wire now: `submitRequest` notifies developers (`request.submitted`, source `req:<id>:submitted:<n>` where n is a counter of submissions from `request_log` so a recall and resubmit notifies again); `saveBrief` on an `accepted` or `event_week` request notifies the linked project's members with editor or higher plus the accepting developer (`request.brief_changed`, source `req:<id>:brief:<version>`). Task 5, 7 and 15 add the other senders.

- [ ] **Step 1: Write failing tests:**
  - `notify` with `requestId` for the requester inserts a row with `projectId` null; for a stranger returns false; with both ids or neither is `InvalidError`.
  - Same `sourceKey` twice leaves one row.
  - `listNotifications` returns a request row with `requestTitle` and null project fields; after the requester loses view access (request moved to a state where they never had it is not possible, so test with a removed account) the row disappears from list and unread count.
  - `submitRequest` creates one `request.submitted` row per admin and event developer, none for the actor; resubmitting after `recallRequest` creates new rows.
  - A brief save on an `accepted` request notifies the project editors, not viewers or the requester.
  - Existing project notification tests still pass unchanged.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/notifications.test.ts src/lib/ops/request-notify.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Update the bell and inbox components so a request row links to its `href` and shows the request title where the project name would be; `rules-table.tsx` gets the new labels.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS (the migration must keep existing rows valid).
- [ ] **Step 5: Commit** `feat(events): notify about requests in the inbox and push`.

### Task 4: Uploads on a local volume

**Files:**
- Create: `src/lib/uploads.ts`, `src/lib/uploads.test.ts`, `src/lib/ops/uploads.ts`, `src/lib/ops/uploads.test.ts`
- Create: `src/app/api/events/uploads/route.ts`, `src/app/api/events/uploads/[id]/route.ts` and route tests
- Modify: `src/db/schema/events.ts` (`event_upload`; add the FK from `event_request.bannerUploadId`), `src/lib/env.ts` (`EVENT_UPLOADS_DIR` in `WORKER_REQUIRED_ENV` with a default applied by `uploadsDir()`, see below), `src/worker/main.ts` start check (directory exists and is writable), `.env.example`, `docker-compose.yml`, `docker-compose.coolify.yml`, `Dockerfile` (create `/data/uploads` owned by `node` before `USER node`), `src/proxy.ts` (the new routes use the existing session check, no matcher change expected)
- Generated: `drizzle/00NN_event-uploads.sql` via `npm run db:generate -- --name event-uploads`

**Interfaces:**
- `UPLOAD_LIMITS = { maxBytes: 8 * 1024 * 1024, types: ["image/png", "image/jpeg", "image/webp", "image/gif"], maxPerRequest: 40 }`. A banner uses the same limits; Discord's own limit for attachments (8 MiB at the lowest tier) is why 8 MiB is the cap.
- `uploadsDir(env?: Record<string, string | undefined>): string`: `EVENT_UPLOADS_DIR`, default `/data/uploads`; throws when empty after trimming.
- `sniffImage(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | "image/gif" | null` from magic bytes (PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF87a`/`GIF89a`, WEBP `RIFF....WEBP`). The declared `Content-Type` is never trusted; a mismatch is `InvalidError`.
- `safePath(dir: string, storageKey: string): string`: joins and verifies the result stays inside `dir` (`Error` otherwise). `storageKey` is `<uploadId>.<ext>` generated server-side from the sniffed type; the original file name is stored only as display text (stripped of path separators and control characters, ≤120 chars).
- Table `event_upload`: `id` text pk, `requestId` text null FK `event_request.id` on delete cascade (null for settings images: disaster, resolved and details templates), `uploaderId` FK user set null, `purpose` text enum `banner | embed | fallback | template`, `originalName` text, `mime` text, `bytes` integer, `storageKey` text unique, `createdAt`. Index on `requestId`.
- Ops:
  - `storeUpload(db, actor, input: { requestId: string | null; purpose; name: string; bytes: Uint8Array }, dir = uploadsDir()): Promise<UploadView>`: request uploads need `edit` access on the request, template uploads need event manager or admin; size and type checks; the per-request count cap; writes the file with `fs.writeFile` using `flag: "wx"` (never overwrites) **before** inserting the row inside the transaction, and removes the file when the insert fails. `UploadView = { id, requestId, purpose, originalName, mime, bytes, url: "/api/events/uploads/<id>" }`.
  - `deleteUpload(db, actor, id, dir?)`: `edit` access; clears references (`event_request.bannerUploadId`, and the upload ids held by fallback scenarios and settings templates are checked in their tasks, so this op takes a registry `UPLOAD_REFERENCES: ((tx, uploadId) => Promise<boolean>)[]` that later tasks append to; deletion with a live reference is `ConflictError("This image is still used by …")`).
  - `openUpload(db, actor, id, dir?): Promise<{ stream: ReadableStream; mime: string; bytes: number; name: string }>` after the access check: request uploads follow `requestAccess(…, "view")` for the owning request **or**, for the event-day/staff view, no special case; template uploads are visible to event managers, admins and developers.
  - `readUploadForWorker(db, uploadId, dir?)` (no actor; used only by the worker jobs of Tasks 11 to 13): returns `{ bytes, mime, name }`.
- Routes: `POST /api/events/uploads` takes `multipart/form-data` with fields `file`, `purpose`, optional `requestId`; session-authenticated like the push resubscribe route; replies `201` with the `UploadView`, `413` for an oversize body (rejected from `Content-Length` and again while reading, never buffering more than `maxBytes + 1`), `415` for a wrong type, `404`/`403` from the ops. `GET /api/events/uploads/[id]` streams the file with `Content-Type` from the row, `Content-Disposition: inline; filename*=UTF-8''…`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=3600`; `404` for unknown id **and** for no access.
- Compose: both files add the named volume `roadmap-uploads` (listed under `volumes:`) mounted at `/data/uploads` in `app` and in `worker`; `EVENT_UPLOADS_DIR: ${EVENT_UPLOADS_DIR:-/data/uploads}` in both services. README table row says: publish-once files, no backup needed.

- [ ] **Step 1: Write failing pure tests** (`uploads.test.ts`): `sniffImage` for one real header per type, junk and an HTML file renamed `.png` return `null`; `safePath(dir, "../x")` and an absolute key throw; the display-name sanitizer strips `../`, slashes and control characters; `uploadsDir` default and the empty-string error.
- [ ] **Step 2: Write failing op tests** (temp directory per test): a 9 MiB buffer is `InvalidError`; a GIF buffer declared as `image/png` is stored as `image/gif` (sniff wins); non-image bytes are `InvalidError` and no file or row remains; a stranger's `storeUpload` is `NotFoundError`; the 41st upload of a request is `InvalidError`; after a forced insert failure no file is left; `openUpload` for a stranger is `NotFoundError`, for the requester returns the bytes; `deleteUpload` removes row and file and, with a registered reference returning true, is `ConflictError`; deleting a request (cascade) leaves files without rows; `sweepOrphanFiles(db, dir, now)` (exported here, used by the reminder job in Task 15) removes files with no row that are older than one day and test that it keeps referenced and fresh files.
- [ ] **Step 3: Run** `npx vitest run src/lib/uploads.test.ts src/lib/ops/uploads.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the library, ops, routes and route tests (POST with the wrong type 415, oversize 413 without reading the whole body, no session 401, GET for a stranger 404, `nosniff` header present).
- [ ] **Step 5: Add the env var and volume everywhere** listed in Files. The worker start check fails with a message naming `EVENT_UPLOADS_DIR` when the directory cannot be created or written.
- [ ] **Step 6: Banner picker.** An `ImageUpload` component (`src/components/events/image-upload.tsx`): file input with drag and drop, progress, preview via the serving URL, size and type hint, remove button. Mount it on the request page overview as "Event banner" and wire `requests.setBanner({ requestId, uploadId | null })` (edit access; logs `banner`).
- [ ] **Step 7: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: PASS. Then `docker compose config` and confirm both services mount the volume.
- [ ] **Step 8: Commit** `feat(events): add image uploads on a local docker volume`.

### Task 5: Typed questions and answers

**Files:**
- Create: `src/lib/event-questions.ts`, `src/lib/event-questions.test.ts`
- Create: `src/lib/ops/request-questions.ts`, `src/lib/ops/request-questions.test.ts`
- Modify: `src/db/schema/events.ts` (`event_question_round`, `event_question`), `src/server/trpc/routers/requests.ts`, `src/lib/ops/requests.ts` (`waitingOnRequester`), the request page (Questions tab), `src/components/events/question-form.tsx`
- Generated: `drizzle/00NN_event-questions.sql` via `npm run db:generate -- --name event-questions`

**Interfaces:**
- `QUESTION_TYPES = ["text", "choice", "multi", "number", "date", "time", "yesno", "scale"] as const`, `type QuestionType`.
- `QUESTION_LIMITS = { perRound: 5, options: 8, textMax: 2000, whyMax: 500, optionMax: 100 }`.
- `askedQuestionInput` (flat on purpose, so the MCP schema stays small; per-type rules enforced by `superRefine` and a pure `validateAsked(q): string[]`):
  - `type` enum, `text` (the question, 1–2000), `why` (optional, ≤500; the UI shows it under the question), `required` (default true), `suggested` (optional; same type as the answer, validated like an answer)
  - `options` (`string[]`, 2–8, each ≤100; only `choice` and `multi`; a duplicate option is an error), `other` (boolean, default false; `choice` and `multi`: allows free text)
  - `min`, `max` (`number` type: numeric bounds; `multi`: min/max count of selections; `scale`: fixed 1–5 or 1–10 through `max`, default 5, `min` is always 1), `unit` (≤20, `number` only)
  - Using a field the type does not allow is an error naming the field.
- `askRoundInput = { questions: askedQuestionInput[] (1–5) }`.
- Answer values, `answerValueSchema(question)` builds the schema per question, stored as JSON in `event_question.answer`:
  - `text`: string ≤2000; `choice`: `{ option: string } | { other: string }` (option must be in `options`; `other` only if allowed); `multi`: `{ options: string[]; other?: string }` with the count between `min` and `max`; `number`: finite number within `min`/`max`; `date`: `YYYY-MM-DD`, a real calendar date; `time`: `HH:MM`, 24 h; `yesno`: boolean; `scale`: integer 1..`max`.
- Tables:
  - `event_question_round`: `id`, `requestId` FK cascade, `number` integer (per request, 1-based, unique with `requestId`), `askedBy` FK user set null, `agent` text null, `createdAt`.
  - `event_question`: `id`, `roundId` FK cascade, `requestId` FK cascade (denormalised for queries), `position` integer, `type`, `text`, `why` text null, `required` boolean, `config` jsonb (`options`, `other`, `min`, `max`, `unit`), `suggested` jsonb null, `answer` jsonb null, `notSure` boolean not null default false, `answeredBy` FK user set null, `answeredAt` timestamptz null, `createdAt`. Index on (`requestId`, `answeredAt`).
- Ops:
  - `askRound(db, actor, requestId, raw: z.input<typeof askRoundInput>): Promise<{ roundId: string; number: number; questionIds: string[] }>`: `develop` access; request status must be `submitted`, `accepted` or `event_week` (`ConflictError` otherwise); a second round while another is fully unanswered is allowed (no branching, no blocking). Notifies the requester `request.question` (title "The team has questions about <event>", source `req:<id>:round:<n>`). Logs `questions` (`round N asked`).
  - `answerQuestions(db, actor, requestId, raw: { answers: { questionId: string; value?: unknown; notSure?: boolean }[] })`: `edit` access (requester or manager). Per answer: unknown id for this request is `InvalidError` naming it; `value` validated by `answerValueSchema`; exactly one of `value` and `notSure: true`; `notSure` on a `required` question is allowed (that is what the button is for). Re-answering overwrites and keeps no history except the log. When every question of a round is answered (value or not sure), notify developers `request.answered`, naming how many are "not sure" (source `req:<id>:answered:<round number>`, body lists the not-sure count). A round with any "not sure" notifies the developer in the same notification, not separately.
  - `listRounds(db, actor, requestId)`: rounds with questions, answers typed back, `notSure`, who and when.
  - `openQuestionCount(db, requestId): Promise<number>`: unanswered questions across rounds; used for `waitingOnRequester` and by Task 15.
- UI Questions tab: for the requester one card per round, one control per type (radio group, checkbox group with a min/max hint and an "Other" text field, number input with unit, date and time inputs, Yes/No segmented control, 1–N scale buttons, textarea), the `why` text under each question, the suggested value pre-selected but marked "suggested", a required marker, and a "Not sure, let the team decide" button per question. A "Waiting on you" banner on the request page when `openQuestionCount > 0` for the requester. Developers see the same round read-only with answers and a "Not sure" badge. Keyboard: radios and checkboxes use native inputs.

- [ ] **Step 1: Write failing pure tests** (`event-questions.test.ts`):
  - `validateAsked`: `choice` with one option fails; nine options fail; `multi` with `min` 3 and `max` 2 fails; `scale` with `max` 7 fails (only 5 or 10); `unit` on `text` fails; duplicate options fail; `suggested` that is not one of the options fails.
  - `answerValueSchema`: `choice` with an unknown option fails, with `other` when `other: false` fails; `multi` 0 selections with `min` 1 fails; `number` 11 with `max` 10 fails; `date` `2026-02-30` fails; `time` `24:00` fails and `23:59` passes; `scale` 0 and `max+1` fail; `yesno` accepts only booleans.
- [ ] **Step 2: Write failing op tests:**
  - `askRound` by a developer with 6 questions is `InvalidError`; with 5 mixed types creates the round with number 1; the second round is number 2; a requester asking is `ForbiddenError`; a `draft` request is `ConflictError`.
  - The requester's notification: exactly one `request.question` row for the requester, none for the asker.
  - `answerQuestions` with one valid answer per type stores typed values and `listRounds` returns the same shapes; a wrong-typed answer is `InvalidError` naming the question; `notSure: true` stores `notSure` and no value; both `value` and `notSure` is `InvalidError`; another request's question id is `InvalidError`; a stranger is `NotFoundError`.
  - Answering the last open question of a round notifies developers once, with the not-sure count in the body; answering a partial round notifies nobody; re-answering after completion does not notify again.
  - `openQuestionCount` and `listRequests(...).waitingOnRequester`.
- [ ] **Step 3: Run** `npx vitest run src/lib/event-questions.test.ts src/lib/ops/request-questions.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement**, add procedures `requests.askRound`, `requests.answerQuestions`, `requests.rounds`, router tests for access, and the UI.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Check it in the browser** with `npm run dev`: as a developer ask a round with all eight types through the tRPC caller (or Task 6's tool when ready), as the requester answer it, press "Not sure" on one, and confirm the developer notification.
- [ ] **Step 7: Commit** `feat(events): add typed question rounds with not-sure answers`.

### Task 6: `ask_requester` and `get_request` tools

**Files:**
- Modify: `src/lib/tools/definitions.ts` (two tools, `write_spec` gains an optional `brief`), `src/lib/tools/registry.test.ts` (`SPEC_TOOLS` gains `ask_requester`, `get_request`), `src/lib/mcp/tool-list.ts` (budget, only if needed), `src/lib/mcp/server.ts` (`MCP_INSTRUCTIONS` gets one short line), `src/lib/tools/openapi.test.ts` if it lists routes, `src/lib/ops/request-link.ts` stub for the spec basis (completed in Task 7)
- Create: `src/lib/ops/request-agent.ts`, `src/lib/ops/request-agent.test.ts`

**Interfaces:**
- `ask_requester` (write, `POST /requests/:request/questions`): input `{ request: string, questions: askedQuestionInput[] }`. Description (≤200 chars): "Ask the event planner up to 5 typed questions about a request; answers come back through get_request." Field descriptions ≤80 chars. Calls `askRound`.
- `get_request` (read, `GET /requests/:request`): input `{ request: string, sinceBrief?: number }`. Description: "Read an event request: brief, event data, typed answers, fallback and progress. sinceBrief returns a brief diff." Output `RequestForAgent`:
  - `{ id, title, status, startsAt, durationMinutes, where, eventDocsUrl, requester: { name }, project: { slug } | null, system: { slug } | null, brief: { version, body } | { version, since, diff }, specBasis: { specVersion: number; briefVersion: number } | null, rounds: { number, questions: { id, type, text, answer, notSure, answered }[] }[], openQuestions: number, notSure: { questionId, text }[], fallback: { key, title, filled: boolean }[], progress: { done, total } | null }`.
  - Without `sinceBrief`, `brief.body` is included; with it, `diff` replaces the body (`InvalidError` unless `sinceBrief` is lower than the current version). Long bodies follow the Part 5 `brief` convention: answers longer than 500 characters are cut with an ellipsis and the number of omitted characters, and `get_request` says so in `truncated: true`.
- `write_spec` gains optional `brief` (positive integer, description ≤80: "Brief version this spec is based on"); passing it for a system that belongs to a request records the basis (`recordSpecBasis`, completed in Task 7). For any other system the input is `InvalidError("This system has no request.")`.
- Access: `requestForAgent(db, actor, requestId)` uses `requestAccess(…, "develop")` and `status !== "draft"`; the agent acts as its developer user, so a requester's own agent cannot ask itself questions.
- **Budget rule:** run `npx vitest run src/lib/mcp/tool-list.test.ts` before and after. Keep the schema flat (one object type with optional fields, no `anyOf` per question type). First shorten descriptions; only if `toolListBytes()` still exceeds `TOOL_LIST_BUDGET_BYTES`, raise the constant by the measured overage rounded up to the next 64 bytes, never by more than 1,536 in total, and state the old and new value and the reason in the commit body. All existing tests on description length (≤200 for tools, ≤80 for fields) must pass.

- [ ] **Step 1: Write failing tests.**
  - `registry.test.ts`: the tool list equals the spec list with the two new names; REST routes are unique; route params are tool inputs (`request`); `ask_requester` is a write tool (has `agent`), `get_request` is not.
  - `request-agent.test.ts`: a developer's `ask_requester` creates a round (shape as Task 5); the same call by the requester is `ForbiddenError`; by a stranger `NotFoundError`; on a `draft` request `NotFoundError`. `get_request` returns typed answers as stored, lists `notSure` entries, reports `openQuestions`, and with `sinceBrief: 1` on a version-2 brief returns a diff and no body; `sinceBrief: 2` is `InvalidError`. A 3,000-character answer is cut and `truncated` is true. `write_spec` with `brief: 1` on a system without a request is `InvalidError`.
  - `tool-list.test.ts` stays green.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement** the tools and ops; run `npm run docs` equivalents if the repo regenerates `openapi.json` (the OpenAPI test shows whether a snapshot needs updating).
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test && npm run test:plugin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(events): add ask_requester and get_request agent tools`.

### Task 7: Accepting a request: create or link a project, progress and the spec basis

**Files:**
- Create: `src/lib/event-template.ts`, `src/lib/ops/request-link.ts`, `src/lib/ops/request-link.test.ts`
- Modify: `src/db/schema/projects.ts` (`project.deadline` timestamptz null), `src/db/schema/events.ts` (`event_spec_basis`), `src/lib/ops/projects.ts` (return and display `deadline`; `updateProjectInput` unchanged: the deadline is set by event ops only), `src/lib/ops/documents.ts` (`writeSpec` accepts the optional basis through an internal parameter, see below), `src/lib/ops/requests.ts` (`onDateChanged` sets `project.deadline`), `src/trpc/invalidation.ts` (`tasks`, `systems`, `planning` gain `"requests"`; `requests` gains `"projects"`, `"systems"`, `"boards"`), the request page (Accept dialog, link card, progress bar), the project overview (deadline chip and a "From request" link)
- Generated: `drizzle/00NN_event-accept.sql` via `npm run db:generate -- --name event-accept`

**Interfaces:**
- `EVENT_TEMPLATE` in `src/lib/event-template.ts` (pure data): board `{ slug: "event", name: "Event", columns: [Planning(planning), To do(todo), Building(active), Review(review), Blocked(blocked), Done(done)] }`, phases `["Build", "Rehearsal", "Event day"]`, domain `"Event"`, system priority `MVP`. `projectSlugFromTitle(title: string, taken: (slug) => Promise<boolean>)` builds a slug through `src/lib/slug.ts` and appends `-2`, `-3` on collision.
- Table `event_spec_basis`: `systemId` FK cascade, `specVersion` integer, `briefVersion` integer, `createdAt`; primary key (`systemId`, `specVersion`).
- `acceptInput`: discriminated on `mode`: `{ mode: "create", projectName?: string, projectSlug?: slugSchema, systemSlug?: slugSchema }` or `{ mode: "link", project: slugSchema, system?: slugSchema }` (without `system` a new system `event` is created in the project).
- `acceptRequest(db, actor, requestId, raw): Promise<{ projectSlug: string; systemSlug: string; specVersion: number | null }>`:
  - `develop` access with `canAcceptRequests(flags)` (admin or event developer; an editor member alone cannot accept: `ForbiddenError("Only admins and event developers can accept requests.")`); status must be `submitted` (`ConflictError` otherwise); the request must have no project yet.
  - `create`: one transaction. Creates a project named after the request (default name = title, slug from the title) owned by the accepting actor, applies `EVENT_TEMPLATE` (replace the default Development board, since it is empty, with the Event board, create phases and domain through shared internal insert helpers that take a `Tx`; if `boards.ts`/`structure.ts` only expose transactional ops, extract the `insert*` helpers there rather than nesting transactions), sets `project.deadline` to the event end (`startsAt + durationMinutes`, or `startsAt` when no duration), creates a system (slug default `event`, title = request title, in the planning column), appends the first spec version whose body is the brief (using the shared `appendVersion` extracted from `documents.ts`; the planning gate stays closed: the spec is a **draft** and the system stays in planning), records `event_spec_basis (systemId, 1, request.briefVersion)`, does **not** add the requester to the project (the progress bar is their view; see open points), links `projectId`/`systemId` on the request, sets `status = accepted`, `acceptedAt`, `acceptedBy`, logs `project` and `status`, notifies the requester `request.accepted` (source `req:<id>:accepted`) with a link to the request.
  - `link`: needs editor or higher on the target project (`projectAccess(…, "editor")`; admins pass); an unknown system slug is `NotFoundError`; with no system a new system is created; **no spec is written for an existing system** (the banner then shows "Brief not applied yet", see Task 8); sets the project deadline only when the project has none (`ConflictError` is not raised); otherwise same link, status and notification steps.
  - Atomic: any failure leaves no project, board or link.
- `requestProgress(db, actor, requestId): Promise<{ total: number; done: number; doing: number; blocked: number; todo: number; percent: number } | null>`: `null` while unlinked; counts tasks of all non-archived systems of the linked project (not only the linked system, since an event build can use several), `percent = round(done / total * 100)`, 0 when there are no tasks. Access is the request `view` rule: **it returns counts only, never task titles**, so a requester who is not a project member learns nothing else. An archived project returns the last counts and a flag `archived: true`.
- `recordSpecBasis(tx, actor, system: SystemRow, specVersion: number, briefVersion: number): Promise<void>`: used by `write_spec` (Task 6) and `accept`; validates `briefVersion <= request.briefVersion` (`InvalidError`) and that the system belongs to a request.
- `unlinkRequest` is **not** offered (a link is permanent short of deleting the project; the project deletion sets the request's `projectId` to null through the FK and the request page then shows "Project deleted").
- tRPC: `requests.accept`, `requests.progress`, `requests.linkable` (projects where the actor is an editor, with their systems, for the Link picker).

**Rules:** the Accept dialog has two tabs "Create project" (default; name and slug preview, the event date shown as the deadline) and "Link to an existing project" (project select then system select or "New system"). The progress bar on the request page shows done/doing/blocked/todo segments and "18 of 24 tasks done"; it is read-only for the requester. The linked project's overview gets a "From event request" chip linking back to `/requests/<id>` for project members who can view the request, and a plain chip without a link for those who cannot.

- [ ] **Step 1: Write failing tests:**
  - `create`: one project exists with the Event board columns in order, three phases, domain `Event`, `deadline` equal to start + duration; one system in the planning column; spec v1 body equals the brief; `event_spec_basis` has (system, 1, briefVersion); request is `accepted` with both ids set; the accepting actor is the project owner; the requester is **not** a member; one `request.accepted` notification for the requester; `request_log` has `project` and `status` rows.
  - A second `accept` is `ConflictError`; an editor member without the developer flag is `ForbiddenError`; a `draft` request is `ConflictError`.
  - A slug collision appends `-2`; a taken explicit `projectSlug` is `ConflictError` and nothing is created (rollback).
  - `link` to a project with an existing system: no new spec version, no basis row, deadline set when empty and untouched when present; with no system a new system is created; a viewer member of the target project is `ForbiddenError`; a project the actor cannot see is `NotFoundError`.
  - `requestProgress`: `null` unlinked; with 1 done, 1 doing, 1 blocked, 1 todo task it returns total 4 and percent 25; archived systems are excluded; the result for the requester (no project membership) has no keys other than the counts and `archived`.
  - `updateRequest` of `startsAt` on an accepted request moves `project.deadline`.
  - `write_spec` via the tool with `brief: 2` records a basis row; `brief` above the request's current version is `InvalidError`.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/request-link.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, including the extracted internal helpers (their existing tests must stay green).
- [ ] **Step 4: Build the UI** (Accept dialog, progress bar component `src/components/events/progress-bar.tsx`, the project chips). Router tests for `accept` and `progress` access.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(events): accept requests into a new or existing project with build progress`.

### Task 8: "Brief changed" flow and the plugin skill and command

**Files:**
- Modify: `src/lib/ops/request-link.ts` (`briefStatusForProject`, `briefStatusForRequest`), `src/lib/ops/projects.ts` or `src/lib/ops/overview.ts` (expose the banner data on the project overview), `src/server/trpc/routers/requests.ts`
- Create: `src/components/projects/brief-banner.tsx`, `src/components/events/update-from-brief-dialog.tsx`, `src/lib/ops/request-link.brief.test.ts`
- Create: `plugin/commands/requests.md`, `plugin/skills/event-requests/SKILL.md`
- Modify: `plugin/skills/plan-system/SKILL.md` (moderation requirements area), `plugin/skills/using-surf-roadmap/SKILL.md` (one line), `plugin/.claude-plugin/plugin.json` (bump the minor version), `plugin/README.md`, the plugin tests (`plugin/scripts/scripts.test.mjs`, `plugin/hooks/hooks.test.mjs`) if they enumerate skills or commands

**Interfaces:**
- `briefStatus(db, actor, { projectSlug } | { requestId }): Promise<BriefStatus | null>` where `BriefStatus = { requestId; requestTitle (only when the actor can view the request, else null); briefVersion: number; specVersion: number | null; basisBriefVersion: number | null; state: "current" | "changed" | "not_applied"; changeCount: number }`:
  - `state = "changed"` when the latest spec's basis brief version is lower than `request.briefVersion`; `changeCount` = number of brief versions since the basis.
  - `"not_applied"` when the system has no basis row (linked to an existing system).
  - `"current"` otherwise. `null` when the system has no request. Project members see the status; the diff is only offered to those who can view the request (`compareBriefs`).
- The banner on the linked project's system page and overview: "Brief changed since spec v3" with a "Show changes" link that opens the diff (`compareBriefs(basis, current)`), and, for editors, an **"Update from brief"** button. The button runs **nothing**: it opens `UpdateFromBriefDialog`, which shows a ready-to-paste instruction for the developer's own agent: `/surf-roadmap:requests update <requestId>` plus a one-sentence explanation, with a Copy button. (The app never calls an agent; see open points.)
- Plugin command `/surf-roadmap:requests [update <request-id> | list | <request-id>]`: reads `surf-roadmap.json`, lists open requests the user may develop (`list_projects` is not enough: the command uses `get_request` only when an id is given, and for listing asks the user for the id from the UI; **no list tool is added**, see open points), then follows the skill.
- Skill `surf-roadmap:event-requests`, steps in order:
  1. `get_request` (with `sinceBrief` set to the spec's basis when updating) and read answers; note `notSure` entries: those are the developer's decisions, decide them with the developer and record the decision as an ADR when it meets the ADR criteria.
  2. First time: run `surf-roadmap:plan-system` on the linked system, using the brief as the idea, **asking the requester** through `ask_requester` instead of the user for questions about the event, and the user (developer) for technical ones. Batch up to 5 typed questions per round; give each a `why`, a `suggested` value where you have one, `required` only where truly needed, never more than 8 options, no branching.
  3. Update: read the diff, `write_spec` with `brief` set to the brief version you read, `write_plan` with all steps (existing steps keep their numbers; new steps get new numbers), and adjust tasks with `update_tasks`/`add_tasks`: **add or change, never delete done work**; tasks of removed steps stay and are reported. Ask follow-up questions with `ask_requester` for anything the change opens.
  4. Report what changed in one `post_update`.
  - The skill states the guarded rules: never touch tasks in state `done`, never answer for the requester, never post to Discord (the app does that).
- `plan-system` gains the planning area text for event systems (when `get_request` shows the system belongs to a request): a **moderation requirements** section the interview must cover before completing: staff roles and how many, chat rules, what is punished and how, banned items and behaviour, who is on call during the event, and how staff reach each other. The answers must land in the spec under a heading "Moderation" and be asked through `ask_requester` (types `number` for staff count, `multi` for roles, `text` for rules) so the team prompt (Task 14) can read them from `get_request`.

- [ ] **Step 1: Write failing tests:**
  - `briefStatus`: after accept (basis 1, brief 1) state `current`; after `saveBrief` (brief 2) state `changed`, `changeCount` 1, `specVersion` 1; after the agent path `writeSpec(…)` with `brief: 2` state `current` again; for a linked-existing-system request state `not_applied`; a project member without request view access gets `requestTitle: null` and no diff; a system without a request returns `null`.
  - Three brief saves in a row give `changeCount` 3.
  - Plugin tests: `npm run test:plugin` stays green after the new skill, command and manifest bump (adjust the expectations those tests have for the skill list).
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/request-link.brief.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the status, the banner and the dialog; write the command, skill and plan-system edits. Keep each skill instruction concrete (tool names, inputs) in the style of `open-question`.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test && npm run test:plugin`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(events): flag changed briefs on projects and add the requests plugin skill`.

### Task 9: Fallback plan, prep to-dos, event-day checklist and the event-week gate

**Files:**
- Create: `src/lib/event-prep-template.ts`, `src/lib/event-prep-template.test.ts`
- Create: `src/lib/ops/request-fallback.ts`, `src/lib/ops/request-fallback.test.ts`, `src/lib/ops/request-prep.ts`, `src/lib/ops/request-prep.test.ts`
- Modify: `src/db/schema/events.ts` (`event_fallback`, `event_todo`, `event_checklist_item`, `event_checkin`), `src/lib/ops/requests.ts` (`startEventWeek`, `onDateChanged` re-dates to-dos), `src/lib/ops/request-link.ts` (create to-dos on accept), `src/lib/ops/uploads.ts` (register upload references), router, the request page tabs Fallback, Prep and Event day
- Generated: `drizzle/00NN_event-fallback-prep.sql` via `npm run db:generate -- --name event-fallback-prep`

**Interfaces:**
- `REQUIRED_FALLBACKS = [{ key: "server-down", title: "Server dies mid-event" }, { key: "staff-missing", title: "Key staff missing" }, { key: "too-few-players", title: "Too few players" }]`.
- Table `event_fallback`: `id`, `requestId` FK cascade, `key` text (the three required keys, or `custom-<id>`), `title` text, `whatWeDo` text not null default `""`, `whoDecides` text not null default `""`, `playerMessage` text null (a prepared message for players, German, may contain placeholders), `imageUploadId` text null FK `event_upload.id` on delete set null, `required` boolean, `sortOrder` integer; unique (`requestId`, `key`). The three required scenarios are created empty when the request is created (`createRequest`), so the tab always shows them.
- Ops (`edit` access; managers and the requester): `listFallbacks`, `saveFallback(db, actor, requestId, fallbackId, input: { title?, whatWeDo?, whoDecides?, playerMessage?: string | null, imageUploadId?: string | null })` (the image must belong to the same request, `InvalidError` otherwise; titles of required scenarios cannot be changed), `addFallback(db, actor, requestId, { title })`, `removeFallback` (only non-required; `ConflictError` for required).
- `fallbackReady(db, requestId): Promise<{ ready: boolean; missing: { key: string; title: string; missing: ("whatWeDo" | "whoDecides")[] }[] }>`: a scenario is complete when `whatWeDo` and `whoDecides` are non-blank after trimming; the player message and image stay optional; a **custom** scenario that is blank does not block (only required ones gate).
- Table `event_todo`: `id`, `requestId` FK cascade, `templateKey` text null, `title`, `ownerUserId` FK user set null, `dueAt` timestamptz not null, `dueManual` boolean not null default false (the owner changed the date by hand), `doneAt` timestamptz null, `doneBy` FK set null, `lastRemindedAt` timestamptz null, `createdAt`.
- `PREP_TEMPLATE` (pure, `src/lib/event-prep-template.ts`): `[{ key: "team-message", title: "Post the team message", offsetDays: -8, owner: "requester" }, { key: "announcement", title: "Post the announcement", offsetDays: -7, owner: "requester" }, { key: "build-ready", title: "Build is ready", offsetDays: -3, owner: "developer" }, { key: "rehearsal", title: "Rehearsal", offsetDays: -2, owner: "developer" }, { key: "reminder", title: "Post the reminder", offsetDays: -1, owner: "requester" }, { key: "recap", title: "Recap and thank-you", offsetDays: 1, owner: "requester" }]`; `dueFor(startsAt: Date, offsetDays: number, timeZone: string): Date` is **09:00 local time in `timeZone` on the date `offsetDays` from the event's local date** (uses `Intl.DateTimeFormat`, no date library; DST-safe). `timeZone` comes from event settings (Task 10; until then the constant `DEFAULT_EVENT_TIME_ZONE = "Europe/Berlin"` in `src/lib/event-prep-template.ts`).
- `ensurePrepTodos(tx, request, developerUserId)`: creates the six to-dos on accept (owner `requester` or the accepting developer). `onDateChanged` re-dates every to-do with `templateKey` set, `doneAt` null and `dueManual` false; a done or hand-dated to-do stays.
- Ops: `listTodos`, `addTodo(db, actor, requestId, { title, ownerUserId?, dueAt })`, `updateTodo(db, actor, todoId, { title?, ownerUserId?, dueAt? })` (setting `dueAt` sets `dueManual`; the owner must be a provisioned user), `setTodoDone(db, actor, todoId, done: boolean)` (owner, requester, manager, developer or admin), `removeTodo` (custom ones only). `late` is derived: `dueAt < now && !doneAt`, returned as a flag for the UI (red) and used by Task 15.
- Table `event_checklist_item`: `id`, `requestId` FK cascade, `key` text null, `label`, `doneAt`, `doneBy`, `sortOrder`. `CHECKLIST_TEMPLATE = [{ key: "server-checked", label: "Server checked by the host" }, { key: "staff-online", label: "Staff online" }, { key: "rewards-ready", label: "Rewards ready" }, { key: "fallback-read", label: "Fallback plan read by the host" }]`; created with the request. Ops `listChecklist`, `setChecklistItem(db, actor, itemId, done)`, `addChecklistItem` (custom), `removeChecklistItem` (custom). Ticking needs the request's `edit` access, a developer, or an event-day staff member (below); ticking is available only in `event_week` (`ConflictError` otherwise) so a checklist cannot be pre-ticked.
- Table `event_checkin`: `requestId` FK cascade, `userId` FK cascade, `at`; primary key (`requestId`, `userId`). `checkIn(db, actor, requestId)` and `checkOut(db, actor, requestId)`: any provisioned user may check **themselves** in while the request is `event_week` (request visibility is deliberately widened for the event-day page, see rule below); `listCheckins` returns names and times; no one can check another user in.
- `startEventWeek(db, actor, requestId)`: `accepted→event_week` for `edit` access or `develop`; `fallbackReady` must be true (`ConflictError` message lists the missing scenarios by title and field); logs `status`. Nothing switches the status on a date.
- **Event-day visibility rule:** while a request is `event_week`, any signed-in user may open `/requests/<id>/event-day`, which shows the title, time, `where`, the checklist (read-only unless they have edit/develop rights), the fallback scenarios and the check-in button, and nothing else (no brief, no answers, no settings). `requestAccess` gains the `staff` role for exactly this view and never for anything else (`eventDayView(db, actor, requestId)` is its own op).
- UI: Fallback tab (one card per scenario with the four fields, image upload via Task 4's component, "Required" badge, completeness indicator); Prep tab (to-do list with owner select, due date, done checkbox, red "Late" badge, "Add to-do"); Event day tab and the event-day page (checklist, check-in list, and a "Something is wrong" panel that expands the fallback scenarios next to the disaster button, which Task 12 wires); "Start event week" button on the request page with the gate message under it.

- [ ] **Step 1: Write failing pure tests:** `dueFor` for an event at `2026-10-17T18:00:00Z` (Europe/Berlin, 20:00 local) with offset -8 is `2026-10-09T07:00:00Z` (09:00 CEST); across the DST end on 2026-10-25 the 09:00 local time stays 09:00 (an event at `2026-10-26T18:00:00Z`, offset -2, is `2026-10-24T07:00:00Z`; offset -1 is `2026-10-25T08:00:00Z`); `PREP_TEMPLATE` has the six offsets.
- [ ] **Step 2: Write failing op tests:**
  - A new request has three empty required fallbacks and four checklist items; `fallbackReady` lists all three with both fields missing; filling two leaves one; a whitespace-only `whatWeDo` is still missing; an extra blank custom scenario does not block.
  - `startEventWeek` with a missing scenario is `ConflictError` naming "Server dies mid-event" and "whoDecides"; with all filled sets `event_week`; from `submitted` it is `ConflictError`; a viewer-only developer who may not edit is `ForbiddenError` (but a `develop` actor passes).
  - `saveFallback` with an image belonging to another request is `InvalidError`; renaming a required scenario is `InvalidError`; removing a required one is `ConflictError`.
  - Accept creates six to-dos with the template due dates; changing `startsAt` by +2 days moves the untouched ones, not a done one, not one with `dueManual`.
  - `updateTodo` with a new `dueAt` sets `dueManual`; owner not provisioned is `InvalidError`; `late` is true after the due date and false once done.
  - Checklist ticking before `event_week` is `ConflictError`; in `event_week` a developer and the requester can tick, a stranger cannot (`NotFoundError`).
  - Check-in: a stranger can check **themselves** in during `event_week` and appears in `listCheckins`; the same call on an `accepted` request is `NotFoundError`; there is no way to pass another user id (signature test).
  - `eventDayView` for a stranger returns only the allowed fields (assert the exact key set).
  - Deleting an upload still used by a fallback is `ConflictError` (reference registered here).
- [ ] **Step 3: Run** `npx vitest run src/lib/event-prep-template.test.ts src/lib/ops/request-fallback.test.ts src/lib/ops/request-prep.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** ops, router procedures and the three tabs plus the event-day page.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(events): add fallback plan, prep to-dos and the event-day checklist`.

### Task 10: Event settings page with admin-only secrets and the team webhook

**Files:**
- Create: `src/lib/ops/event-settings.ts`, `src/lib/ops/event-settings.test.ts`, `src/lib/event-placeholders.ts`, `src/lib/event-placeholders.test.ts`
- Modify: `src/db/schema/events.ts` (`event_settings`), `src/lib/ops/uploads.ts` (register template image references), the router, `src/lib/event-prep-template.ts` (read the time zone from settings)
- Create: `src/app/(app)/(global)/requests/settings/page.tsx` + `event-settings-view.tsx`, `src/components/events/secret-field.tsx`, `src/components/events/embed-template-editor.tsx`
- Generated: `drizzle/00NN_event-settings.sql` via `npm run db:generate -- --name event-settings`

**Interfaces:**
- Table `event_settings`: one row, `id` text pk always `"default"`; created on first read with defaults.
  - **Secret columns (write: admin only):** `publicWebhookEnc`, `publicWebhookHint`, `teamWebhookEnc`, `teamWebhookHint`, `staffWebhookEnc`, `staffWebhookHint`, `botTokenEnc`, `botTokenHint` (all text null; hint = last 4 characters).
  - **Managed columns (write: event managers and admins):** `postAs` text (default `"Event-Team"`, ≤80), `pingRoleId` text null (digits 15–21), `guildId` text null (digits), `timeZone` text (default `Europe/Berlin`, validated like Part 6's `timeZone`), `rulebookUrl` text null (https), `announcementStyle` text, `announcementExample` text, `reminderExample` text, `teamStyle` text, `teamExample` text (each ≤20,000), `disasterTemplate` jsonb, `resolvedTemplate` jsonb, `detailsTemplate` jsonb, `updatedBy`, `updatedAt`.
  - `EmbedTemplate = { title: string (≤256); text: string (≤4,096); color: string "#rrggbb"; imageUploadId: string | null }`, with defaults: disaster title "Wir arbeiten an einer Lösung" text "{event} ist gerade nicht erreichbar. Wir arbeiten an einer Lösung und melden uns hier, sobald es weitergeht." color `#c23636`; resolved title "Das Event ist nun wieder online" text "{event} läuft wieder. {note}" color `#1a7048`. `DetailsTemplate = { lines: string[] (≤10 lines, each ≤200, may contain placeholders); color: "#rrggbb"; footer: string (≤200) }` with default lines `["Datum: {date}", "Uhrzeit: {time}", "Dauer: {duration}", "Ort: {where}", "Infos: {docs}", "Regeln: {rules}"]`, footer `"Viel Spaß!"`.
  - `DEFAULT_STYLE_GUIDES`: short German placeholders so the prompt builder never sends an empty style (stored empty means "use the default text").
- `PLACEHOLDERS = ["event", "date", "time", "duration", "docs", "rules", "where", "note"] as const`.
- `placeholderValues(request, settings, now?, note?)` (pure): `event` = title; `date` = German long date in `settings.timeZone` (`Samstag, 17. Oktober 2026`, from `Intl.DateTimeFormat("de-DE", { dateStyle: "full" })`); `time` = `20:00 Uhr`; `duration` = `2 Stunden` / `1 Stunde 30 Minuten` / `45 Minuten`; `docs` = `eventDocsUrl`; `rules` = `rulebookUrl`; `where` = `request.where`; `note` = the optional note. Missing data gives an empty string.
- `fillPlaceholders(template: string, values: Partial<Record<Placeholder, string>>, opts?: { allow?: readonly Placeholder[] }): string`: replaces `{name}` for known names only (and only the ones in `allow`, default all but `note`); unknown `{names}` stay literally; an empty replacement collapses doubled spaces and trims trailing space on the line; the value is inserted as plain text and never re-scanned for placeholders (no recursion); `{{event}}` is **not** an escape (stays as written).
- `validateTemplate(text, allow)`: returns the unknown placeholders for the editor warning ("`{foo}` is not a known placeholder"); unknown ones are a warning, not an error, because the decisions allow free text with braces.
- Ops:
  - `getEventSettings(db, actor): Promise<EventSettingsView>`: event managers, developers and admins (`ForbiddenError` for others). Returns the managed columns and, for each secret, `{ set: boolean; hint: string | null }` where hint is `••••abcd`. **No `Enc` value, no URL and no token is ever in the result**; the view type has no such property.
  - `updateEventSettingsInput = z.strictObject({ …managed columns, all optional })`: strict, so any secret key sent by a manager is a validation error (`InvalidError` naming the key). `updateEventSettings(db, actor, raw)`: manager or admin; records only `updatedBy` and `updatedAt` on the row and `console.info`s the changed field names (never values); there is no request for `request_log` and no audit table is added (see open points).
  - `setEventSecretsInput = z.strictObject({ publicWebhook?: string | null, teamWebhook?: string | null, staffWebhook?: string | null, botToken?: string | null })`: each webhook must match the Part 6 webhook URL pattern (`^https://(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)/api/webhooks/\d+/[\w-]+$`) with the same message; the bot token must match `^[\w.-]{50,100}$` without whitespace; `null` clears. `setEventSecrets(db, actor, raw)`: **admin only** (`ForbiddenError("Only admins can change event secrets.")`), encrypts with `encryptSecret`, stores hint, never logs or echoes the value. An event manager calling it is `ForbiddenError` even if they also hold other flags.
  - `loadEventSecrets(db): Promise<{ publicWebhook: string | null; teamWebhook: string | null; staffWebhook: string | null; botToken: string | null }>`: decrypts; **imported only by worker code** (`src/worker/**`), enforced by a test that greps the import graph: no file under `src/app`, `src/server` or `src/components` imports it.
  - `checkDiscordWebhook` is **not** added: validation of a webhook happens only through a test send (Task 12), never at save time (the app does not call Discord from a web request).
- tRPC `requests.settings.get`, `requests.settings.update`, `requests.settings.setSecrets`, `requests.settings.preview({ template, kind })` (renders a template with a sample request, for the editor preview; no Discord).
- UI at `/requests/settings`, reachable from the Requests page header "Event settings" (event managers, developers read-only, admins full):
  - Sections: Channels (post-as name, ping role id, guild id, time zone), Webhooks and bot (four masked secret fields shown only to admins as editable: "Set" / "Replace" / "Clear"; managers see ••••abcd and a note "Only admins can change secrets"), Rulebook URL, Announcement style guide with the two examples, Team message style with example, Disaster template, Resolved template, Details template (each embed template with live preview and the placeholder list as chips that insert on click).
  - The admin secret form posts to `setSecrets` only; the managed form never includes secret fields.

- [ ] **Step 1: Write failing pure tests** (`event-placeholders.test.ts`): known placeholders fill; `{foo}` stays; empty `{where}` in `"Ort: {where} – Infos"` yields `"Ort: – Infos"` with no double space; a value containing `{event}` is not expanded again; `{note}` is left as written when not allowed (disaster template) and replaced when allowed; `duration` formats 45, 60, 90, 120 minutes in German; `date` and `time` for `2026-10-17T18:00:00Z` in `Europe/Berlin` are `Samstag, 17. Oktober 2026` and `20:00 Uhr`.
- [ ] **Step 2: Write failing op tests:**
  - **Review Focus 1:** `JSON.stringify(await getEventSettings(db, manager))` contains none of `discord.com/api/webhooks`, the token text, `Enc`, or any substring of the encrypted value; after an admin sets a webhook the manager sees `{ set: true, hint: "••••<last4>" }`.
  - A manager's `updateEventSettings({ publicWebhook: "…" })` is `InvalidError`; `setEventSecrets` by a manager is `ForbiddenError`; by an admin stores an encrypted value (the column does not equal the plaintext and `decryptSecret` round-trips) and the hint is the last four characters.
  - An `https://example.com/hook` URL is `InvalidError` with the Part 6 message; a bot token with spaces is `InvalidError`; `null` clears and `set` becomes false.
  - A developer (non-manager) can read but not update; a stranger cannot read.
  - Template validation: color `red` is `InvalidError`; a details template with 11 lines is `InvalidError`; `imageUploadId` of an upload that belongs to a request (not a template upload) is `InvalidError`.
  - The import-graph test for `loadEventSecrets` (read the source files, assert no import from the forbidden folders).
  - `setEventSecrets` writes nothing recognisable to `console` (spy on `console.*` and assert the secret never appears), and the thrown error for an invalid URL does not contain the URL.
- [ ] **Step 3: Run** `npx vitest run src/lib/event-placeholders.test.ts src/lib/ops/event-settings.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the table, ops, router and page; wire `dueFor` to read `timeZone` from settings (fall back to the default constant when the row does not exist).
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(events): add event settings with admin-only secrets and a team webhook`.

### Task 11: The post engine: composer, splitting, sending, stored message ids

**Files:**
- Create: `src/lib/discord-limits.ts`, `src/lib/discord-limits.test.ts`, `src/lib/event-messages.ts`, `src/lib/event-messages.test.ts`, `src/lib/discord-webhook.ts`, `src/lib/discord-webhook.test.ts`
- Create: `src/lib/ops/request-posts.ts`, `src/lib/ops/request-posts.test.ts`, `src/worker/jobs/events-post.ts`, `src/worker/jobs/events-post.test.ts`
- Modify: `src/db/schema/events.ts` (`event_post`), `src/worker/jobs.ts` registration list (or the module that imports jobs), `src/uploads` readers, the router, the request page Messages tab, `src/components/events/post-composer.tsx`
- Generated: `drizzle/00NN_event-posts.sql` via `npm run db:generate -- --name event-posts`

**Interfaces:**
- `POST_KINDS = ["team", "announcement", "reminder", "disaster", "resolved"] as const`; each kind's **target**: `team` → `teamWebhook`, `announcement`, `reminder`, `disaster`, `resolved` → `publicWebhook`. **Due offsets** (display only, never scheduling): team −8 d, announcement −7 d, reminder −1 d.
- Table `event_post`:
  - `id`, `requestId` FK cascade, `kind` enum, `status` enum `draft | sending | partial | posted | failed | deleted`
  - `text` text not null default `""` (the full body as the person edited it; the source of the split)
  - `embed` jsonb null (the card: `{ title, description, color, imageUploadId, fields: { name, value }[], footer }` for the details embed / disaster / resolved)
  - `pingRole` boolean not null default false, `note` text null (resolve only)
  - `parts` jsonb not null default `[]`: ordered `{ kind: "text" | "embed" | "event-link"; content: string; embed?: Embed; uploadId?: string | null; messageId: string | null; sentAt: string | null }[]`
  - `attempt` integer not null default 0, `lastError` text null (never contains a URL or token), `postedAt`, `postedBy` FK user set null, `createdBy`, `createdAt`, `updatedAt`
  - A partial unique index so a request has at most one non-`deleted` post per kind except `disaster` and `resolved`: unique (`requestId`, `kind`) where `status <> 'deleted'` and `kind in ('team','announcement','reminder')`. A second **disaster** post is allowed only after the previous one is `deleted` or `posted` and resolved (Task 12).
- Pure `discord-limits.ts`: constants from Global Constraints; `countEmbedChars(embed)` (title + description + field names and values + footer text + author name); `splitText(text: string, max = 2000): string[]`:
  - split at blank-line paragraph boundaries; pack paragraphs greedily into chunks ≤ `max` code points joined by `\n\n`;
  - a heading line (`# …` as the first line) always stays with the following paragraph (never alone at the end of a chunk);
  - a paragraph longer than `max` is split at the last sentence end (`. `, `! `, `? `, newline) before `max`, then at the last space, then hard at `max` as a last resort, never inside a surrogate pair, a markdown link `[x](y)`, or a custom emoji `<:name:id>` if avoidable;
  - empty chunks are dropped; whitespace trimmed per chunk; the concatenation of all chunks with their separators contains every non-whitespace character of the input exactly once and in order.
  - `fitsMessage({ content, embeds })`: content ≤ 2,000, embed total ≤ 6,000, ≤ 10 embeds, ≤ 25 fields, every per-field limit.
- Pure `event-messages.ts` (German literals): `buildDetailsEmbed(request, settings, now?)` from the details template and placeholders (title `request.title`, `url` = event docs URL, description the filled lines, color, footer, image `attachment://<file>` when a banner exists); `buildDisasterEmbed`, `buildResolvedEmbed` (Task 12 uses them); `GERMAN = { testMarker: "Testnachricht (nur für das Team)", resumed: "…" }`; `plannedParts(post, request, settings, opts: { discordEventUrl: string | null })`:
  - `text` → chunks via `splitText` (`content` parts);
  - the **last part is always its own message**: with a `discordEventUrl` an `event-link` part whose content is exactly that URL (Discord renders the event card from it); otherwise an `embed` part with the details embed. When the post has an explicit `embed` it replaces the generated details embed. The card is never merged into a text part.
  - The first text part starts with the `# <event name>` heading when the text does (announcement and reminder text is stored with its heading; the app does not invent one).
  - The role ping text `<@&id>` is prepended to the first part's content only when `pingRole` and the kind is `announcement` (or `reminder` when chosen) **and** the content still fits 2,000 characters (the chunk limit for the first part is reduced by the mention length when pinging).
  - Every part is validated with `fitsMessage`; a violation is a thrown `Error` naming the part number.
- `discord-webhook.ts` (fetch only, no database): `sendMessage(url, body: DiscordBody, files?: {name; bytes; mime}[]): Promise<WebhookResult>`, `editMessage(url, messageId, body, files?)`, `deleteMessage(url, messageId)`. All use `?wait=true` for sends (so the id returns), a 10 s `AbortSignal.timeout`, and `username` = `settings.postAs`. With files, use `multipart/form-data` (`payload_json` + `files[n]`) and `attachment://<name>` references. `WebhookResult = { kind: "ok"; id: string } | { kind: "retry"; delayMs: number } | { kind: "gone"; status: 401 | 404 } | { kind: "rejected"; status: number } | { kind: "failed"; error: Error }`; 429 reads `retry_after` as in `src/worker/jobs/discord.ts` (extract and share `retryAfterSeconds`); errors name only the webhook **kind** (`team`, `public`, `staff`), never the URL. `allowed_mentions` is part of `DiscordBody` and required (the type has no optional form).
- Ops (`request-posts.ts`):
  - `savePostDraft(db, actor, requestId, kind, input: { text?: string; embed?: Embed | null; pingRole?: boolean; note?: string | null })`: `edit` access; upsert of the one post of the kind; not allowed once `sending|partial|posted` (use edit, Task 12); `pingRole` allowed only for `announcement` and `reminder` (`InvalidError` for others, since team and disaster never ping); text ≤ 20,000.
  - `previewPost(db, actor, requestId, kind)`: returns `plannedParts` (no Discord, no secrets) so the UI shows how many messages it will become and each message's length.
  - `startPost(db, actor, requestId, kind, queue: JobQueue)`: `edit` access; status must be `draft` or `failed` with no message ids (`ConflictError` otherwise; `partial` uses `resumePost`); the target webhook must be set (`ConflictError("The <kind> webhook is not set. An admin sets it in Event settings.")`, without exposing anything else); the request must be `accepted` or `event_week` (not `draft|submitted|done|withdrawn|cancelled`); for `announcement` and `reminder` a non-empty text; stores the planned `parts` (all `messageId: null`), sets `status = "sending"`, `attempt += 1`, logs `post` (`announcement sending`), and enqueues `events.post` on `QUEUE.deliver` with `jobId: "event-post-<postId>-<attempt>"`. The click returns immediately.
  - `resumePost(db, actor, requestId, kind, queue)`: for `partial` or `failed` posts; re-plans **only the unsent tail** if the text changed since (parts with a message id are frozen), increments `attempt`, enqueues with the new job id. Returns `ConflictError` for `sending` (a job is already running) and for `posted`.
  - `listPosts(db, actor, requestId)` returns kind, status, parts count, `sentCount`, `lastError`, `postedAt`, `postedBy` name, due date for team/announcement/reminder (from `startsAt`), and a `late` flag.
- Job `events.post` `{ postId, attempt }` on `QUEUE.deliver`, registered with `attempts: 5`, exponential backoff 5 s:
  1. Take the Kv lock `event-post:<postId>` (`setIfAbsent`, 120 s); if held, re-enqueue with `delayMs: 5000` (max 10 times) and return.
  2. Load the post, request, settings, secrets (`loadEventSecrets`), and read upload bytes with `readUploadForWorker`. If the post is no longer `sending` for this `attempt`, return (a stale job).
  3. For the announcement with a bot token and no `discordEventId`: enqueue `events.discord-event` is **not** used here; Task 13 hooks `ensureDiscordEvent(deps, request)` before the first send (a stub returning `null` until then). With no bot token, the event card is the details embed.
  4. For each part in order **without** a `messageId`: send; on `ok` store `messageId` and `sentAt` in the post row **in its own transaction immediately**, then continue; on `retry` set `lastError`, re-enqueue itself with `delayMs` from Discord and the same `attempt` suffixed `-r<n>` (job id `event-post-<postId>-<attempt>-r<n>`), return without failing; on `gone` set `status = failed`, `lastError = "Discord no longer accepts the <kind> webhook (<status>). An admin must set a new one."`, notify admins (`request.pickup` is **not** reused; the failure is shown on the post and the job returns without retry); on `rejected` (other 4xx) set `failed` with the status text and stop (no retry, so it never loops); on `failed` (5xx/network) set `partial` when at least one part was sent, else `failed`, keep the error, and **throw** so BullMQ retries; the retry only sends parts without ids (Review Focus 5).
  5. When every part has an id: `status = posted`, `postedAt`, `postedBy` = the starter (stored on the row at `startPost`), tick the matching template to-do (`team-message`, `announcement`, `reminder`) with `doneBy` = the starter, log `post`.
  - The role mention and `allowed_mentions: { parse: [], roles: [id] }` are used for **part index 0 of the first successful send of an `announcement` (or a `reminder` with `pingRole`) only**: if part 0 already has an id (resume), no ping is ever sent again.
  - A crash between Discord's answer and the database write can duplicate one part on retry; this is documented in the UI as "If the post stalls, check the channel before resuming" and noted in the README (see open points).
- UI Messages tab: one card per kind (Team notice, Announcement, Reminder; Disaster and Resolved appear in Task 12), each with a due date chip ("due 9 Oct", red when late and unposted), the editor (textarea with the placeholder chips and character counter), the "Ping @Event-Ping" checkbox (announcement and reminder only), a preview listing "3 messages: 1,812 / 1,740 / event card" with an expandable text per message, status badge, `lastError`, and the buttons **Post now** (confirmation dialog "This posts to <channel name>. It cannot be undone except by deleting the messages." showing whether it pings), **Resume** for `partial|failed`, and (Task 12) Edit, Delete, Test send. The buttons are disabled with a reason when the webhook is unset, the request status does not allow it, or the text is empty.

- [ ] **Step 1: Write failing pure tests.**
  - `discord-limits.test.ts`: a 4,500-character text of 15 paragraphs splits into 3 chunks each ≤ 2,000 with split points at blank lines; rejoining loses no non-whitespace character and keeps order; a single 5,000-character paragraph splits at sentence ends then hard; a heading followed by a paragraph that does not fit stays with its paragraph; an emoji straddling position 2,000 is not split; `fitsMessage` fails for 2,001 characters, a 6,001-character embed total, 11 embeds and 26 fields; counts use code points (a string of 1,001 two-code-unit emoji counts 1,001, not 2,002).
  - `event-messages.test.ts`: `plannedParts` for a 3,900-character announcement with a role ping gives 2 text parts + 1 event card part; the card part is last and alone; with a `discordEventUrl` the last part is `event-link` with exactly that URL; without it an `embed` part with the filled lines; the first part content starts with `<@&123456789012345678>` only when `pingRole` and the first chunk plus the mention is ≤ 2,000; the mention is absent for `team` and `reminder` unless chosen (`reminder` + `pingRole` has it); a part violating limits throws naming the part number.
  - `discord-webhook.test.ts` (`vi.stubGlobal("fetch")`): a send posts to `<url>?wait=true`, returns the id from the JSON; 429 gives `retry` with `ceil(retry_after*1000)+250`; 404 `gone`; 400 `rejected`; 500 and a thrown fetch error `failed`; the error message never contains the URL (assert with a URL containing a marker token); the body always has `allowed_mentions`; with files the request is multipart and `payload_json` references `attachment://`.
- [ ] **Step 2: Write failing op and job tests** (`memoryQueue`, `memoryKv`, stubbed fetch, temp uploads dir):
  - `savePostDraft` for `team` with `pingRole: true` is `InvalidError`; a stranger is `NotFoundError`; an edit after `posted` is `ConflictError`.
  - `startPost` without the webhook is `ConflictError` with the exact message; on a `draft` request `ConflictError`; success stores `parts` (all null ids), `status: "sending"`, one job `event-post-<id>-1`; a double click (second call) is `ConflictError`, one job only.
  - **Happy path:** a 3-part announcement with `pingRole`: fetch called 3 times in order, ids stored, `posted`, the first call's body has `allowed_mentions.roles` = `[roleId]` and `parse: []`, the other two have `parse: []` and no roles, the to-do `announcement` is done, `postedBy` set.
  - **Review Focus 5:** fetch answers `ok` for part 1, 500 for part 2: job throws, post is `partial`, part 1 has its id, part 2 none; re-running the job sends **only parts 2 and 3** (fetch call count 2 on the retry), part 1 is never sent again, and no later call carries a role mention.
  - A 429 on part 2 stores nothing for part 2, enqueues a delayed retry job with the id `…-r1` and the job returns normally.
  - A 404 on any part sets `failed` with the German-independent English error text, no retry job, error text contains no URL.
  - A 400 sets `failed`, no throw, no retry.
  - `resumePost` on a `sending` post is `ConflictError`; on `partial` with changed text re-plans only parts without ids and keeps sent parts untouched; the sent parts' content is not edited.
  - A stale job (attempt number older than the row's) sends nothing.
  - The Kv lock: a held lock re-enqueues once with a 5 s delay.
  - `listPosts` marks `late` for an unposted announcement whose due date passed.
  - **Review Focus 1 (error text):** force `gone`/`rejected`; `lastError` and every thrown message exclude the URL and the encrypted value.
- [ ] **Step 3: Run** the new test files. Expected: FAIL.
- [ ] **Step 4: Implement**, register `events.post` in the worker (with `attempts: 5` and the backoff), add procedures `requests.posts.{list, saveDraft, preview, start, resume}`, and the Messages tab.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(events): post split event messages with stored message ids and resume`.

### Task 12: Editing, deleting, test sends, disaster and resolved messages

**Files:**
- Modify: `src/lib/ops/request-posts.ts`, `src/lib/ops/request-posts.test.ts`, `src/lib/event-messages.ts`, `src/worker/jobs/events-post.ts`, `src/worker/jobs/events-post.test.ts`, the router, the Messages and Event day tabs, `src/components/events/post-composer.tsx`, `src/components/events/disaster-panel.tsx`

**Interfaces:**
- Jobs (same file, same lock, `QUEUE.deliver`): `events.edit` `{ postId, editVersion }`, `events.delete` `{ postId }`, `events.test` `{ requestId, kind, userId }`, with the retry policy of `events.post`.
- `editPost(db, actor, requestId, kind, input: { text?: string; embed?: Embed | null }, queue)`: `edit` access; allowed for `posted` and `partial` posts; stores the new `text`, re-plans, sets `status = "sending"` with a new `attempt` and an `editVersion` marker on the row, enqueues `events.edit` with `jobId: "event-edit-<postId>-<attempt>"`. **The edit job never pings:** every PATCH and every new message sent by it uses `allowed_mentions: { parse: [] }`, the role mention text present in the stored first part is kept as it is (editing the text does not add or remove it; if the person deleted it from the text, it is gone, and nothing pings either way).
- Edit job rules (Review Focus 3), for the new planned text parts `T` (length n) versus the stored text parts `S` (length m) and the stored last card part `C`:
  1. PATCH the first `min(n, m)` text parts in order, using the stored ids, with changed content only (an unchanged chunk is skipped, no request).
  2. If `n > m`: delete the card message `C` (its stored id), then **send** the extra text parts as new messages (`parse: []`), then **re-send the card as the last message** and store the new ids in order (the card's old id is replaced). A failure after the delete and before the re-send leaves the post `partial` with the card part id cleared, which `resumePost` completes (so the card is never lost silently).
  3. If `n < m`: delete the surplus text messages (ids of `S[n..m)`), remove them from `parts`; the card stays last.
  4. The card part: PATCH it when its embed content changed (re-sending the banner file in the multipart body so the attachment is kept); an `event-link` card is unchanged when the Discord event URL is unchanged.
  5. Each stored id is updated, deleted or replaced exactly once; the `parts` array is persisted after **each** successful call; at the end `status = posted`.
  6. A 404 on a PATCH of one message (deleted by a human in Discord) re-sends that part as a new message, stores the new id, and continues (no ping, no failure); the same 404 treatment applies to the card.
- `deletePost(db, actor, requestId, kind, queue)`: `edit` access (or manager); allowed for `posted|partial|failed` with ids; enqueues `events.delete`; the job DELETEs each stored id (a 404 counts as deleted), clears ids as it goes, sets `status = deleted` when all are gone; a 5xx throws and retries; for an announcement with a Discord event it does **not** delete the Discord event (cancelling the request does, Task 13).
- `testSend(db, actor, requestId, kind, queue)`: `edit` access; needs the **staff** webhook (`ConflictError("The staff test webhook is not set. An admin sets it in Event settings.")`); enqueues `events.test` with `jobId: "event-test-<requestId>-<kind>-<minute>"`; the job takes the saved draft text, fills placeholders, adds the German marker line `GERMAN.testMarker` as the **first line**, plans parts exactly as a real post would **but forces `pingRole = false`, strips any literal `<@&…>` mention text from the content, and uses the details embed (never an `event-link` part)**, sends them to the staff webhook with `allowed_mentions: { parse: [] }`, and stores **nothing** on the post (no ids, no status change); the result (`sent n messages` or the error) is returned to the UI through a short-lived Kv key `event-test:<requestId>:<kind>` (60 s) that the `requests.posts.testResult` query reads. **It never calls `loadEventSecrets().botToken`, `ensureDiscordEvent` or the bot REST client** (Review Focus 2). Not allowed for `disaster`/`resolved` text (those have their own preview, and a test of them would be a real announcement of a problem): `testSend` for those kinds is `InvalidError`.
- Disaster and resolved:
  - `postDisaster(db, actor, requestId, queue)`: `edit` access or event manager or admin, request status `event_week` (`ConflictError` otherwise: a disaster message outside the event week is almost certainly a mistake); needs the public webhook; creates an `event_post` of kind `disaster` (not subject to the one-per-kind index; refuses if another disaster post is in `sending|partial|posted` and not resolved: `ConflictError("A disaster message is already posted. Resolve it first.")`) with the `disasterTemplate` filled (`allow` excludes `note`), a single `embed` part, `allowed_mentions: { parse: [] }`, **no ping, ever** (`pingRole` forced false and the type does not allow it for this kind); sends through the Task 11 job (same retry and stored-id rules). Image from `imageUploadId` of the template, sent as an attachment.
  - `resolveDisaster(db, actor, requestId, input: { note?: string (≤500) }, queue)`: requires a `posted` disaster post without `resolvedAt`; stores `note`; enqueues `events.resolve`:
    1. PATCH the disaster message (stored id) to the `resolvedTemplate` filled with `{note}` allowed (`parse: []`);
    2. send a short reply **as a new message** in the same channel, German, `GERMAN.backOnline(eventTitle)` = `"{event} ist wieder online."` with `message_reference` pointing at the disaster message id (`fail_if_not_exists: false`) and `parse: []`;
    3. store the reply's id in `parts` and set `resolvedAt`.
    A PATCH that 404s (message deleted in Discord) falls back to posting the resolved embed as a new message. Resolving twice is `ConflictError`. A new disaster can be posted after `resolvedAt` is set.
- UI: Messages tab cards gain **Edit** (reopens the text, shows "N messages will be updated; edits never ping"), **Delete** (confirmation), **Test send** (button "Send to staff channel", result toast "3 test messages sent to #event-staff" or the error; disabled with a reason without the staff webhook). The Event day tab and event-day page get the **disaster panel**: button "Post disaster message" (confirmation: shows the filled embed preview and "No ping will be sent."), while a disaster is posted a "Resolve" button with an optional note field and the preview of the resolved embed. A disaster or resolved post uses the same per-part status and Resume as Task 11.

- [ ] **Step 1: Write failing tests** (fetch stubbed and recorded; each call's method, URL path and body are asserted):
  - **Edit, same count (Review Focus 3):** a posted 3-part announcement (2 text + card) edited so only text part 2 changes: exactly one PATCH to `…/messages/<id2>?`, body `allowed_mentions: { parse: [] }` and no `roles` key anywhere; no POST, no DELETE; ids unchanged; `status` posted.
  - Edit with both text parts changed: PATCH for each stored id (2 PATCH), card untouched (no PATCH for an unchanged card).
  - **Edit grows 2 → 3 text parts:** sequence is DELETE card, POST text 3, POST card; the new `parts` order is text1, text2, text3, card with the new card id stored; no call has a role mention; if the second POST fails with 500 the post is `partial` with the card id cleared and `resumePost` re-sends the card only.
  - **Edit shrinks 3 → 2:** DELETE of the third text message only, card untouched.
  - A PATCH that answers 404 re-sends that part, stores the new id, no failure.
  - `editPost` on a `draft` post is `ConflictError`; a stranger `NotFoundError`; a post whose banner exists re-sends the file with the card PATCH (multipart).
  - **Delete:** DELETE per stored id in order; a 404 counts as gone; `deleted` at the end; a 500 on the second id throws, ids of the first are cleared, a retry deletes only the rest; the Discord event (stubbed bot client) is **not** called.
  - **Test send (Review Focus 2):** with the staff webhook set and a bot token set and `pingRole: true` on the saved draft: fetch is called only against the **staff** webhook URL (assert the URL), the body has `allowed_mentions: { parse: [] }`, no content contains `<@&`, the first line is the German marker, the last message is the details embed (not an event link), **the bot client and `ensureDiscordEvent` mocks are never called**, the post row is unchanged (`status`, `parts`, `messageId`s), and the Kv result key is set. Without the staff webhook `ConflictError`; `testSend` for `disaster` is `InvalidError`. A double click inside the minute leaves one job.
  - **Disaster:** outside `event_week` `ConflictError`; without the public webhook `ConflictError`; success sends one embed with the filled template (placeholders `{event}`, `{date}`… filled, `{note}` left out), `allowed_mentions: { parse: [] }`, no content ping, the image as an attachment when set; a second disaster before resolve is `ConflictError`.
  - **Resolve:** PATCH of the disaster message id with the resolved embed (note filled; empty note collapses the placeholder cleanly), then a POST reply with `message_reference.message_id` equal to the disaster id and German text, `parse: []`; `resolvedAt` set; reply id stored; a second resolve is `ConflictError`; a 404 on the PATCH falls back to a new embed message; a new disaster is allowed afterwards.
  - Placeholders `{docs}`, `{rules}`, `{where}`, `{date}`, `{time}`, `{duration}` appear filled in the disaster embed for a fixture request.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/request-posts.test.ts src/worker/jobs/events-post.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the ops, the three jobs plus `events.resolve`, router procedures (`requests.posts.{edit, delete, testSend, testResult, disaster, resolve}`) and the UI.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(events): edit, delete and test event posts and post disaster messages`.

### Task 13: Real Discord scheduled events with the bot token

**Files:**
- Create: `src/lib/discord-bot.ts`, `src/lib/discord-bot.test.ts`, `src/worker/jobs/events-discord-event.ts`, `src/worker/jobs/events-discord-event.test.ts`
- Modify: `src/lib/ops/requests.ts` (`onDateChanged`, `cancelRequest`), `src/lib/ops/request-posts.ts`, `src/worker/jobs/events-post.ts` (`ensureDiscordEvent`), `src/lib/ops/event-settings.ts` (`botStatus` fields), the request page (event card status line)

**Interfaces:**
- `discord-bot.ts` (fetch only, base `https://discord.com/api/v10`, header `Authorization: Bot <token>`, 10 s timeout, no gateway, no websockets):
  - `createScheduledEvent(token, guildId, body: { name: string; description: string; startsAt: Date; endsAt: Date; location: string; imageDataUri?: string }): Promise<BotResult<{ id: string }>>` posting `entity_type: 3` (external), `privacy_level: 2` (guild only), `entity_metadata: { location }`, `scheduled_start_time`, `scheduled_end_time` (required for external events), `description`, `name` ≤ 100, `description` ≤ 1,000, `image` as a data URI.
  - `updateScheduledEvent(token, guildId, eventId, partialBody)`, `deleteScheduledEvent(token, guildId, eventId)`.
  - `BotResult<T> = { kind: "ok"; value: T } | { kind: "retry"; delayMs: number } | { kind: "gone" } | { kind: "denied"; status: 401 | 403 } | { kind: "rejected"; status: number; message: string } | { kind: "failed"; error: Error }`; errors never contain the token.
  - `scheduledEventUrl(guildId, eventId) = "https://discord.com/events/<guildId>/<eventId>"`.
- `eventPayload(request, settings)` (pure): `name` = title (≤100, cut with `…`), `description` = the first 700 characters of the brief's first paragraph plus a final German line `Infos: <eventDocsUrl>` (the docs link is **required** in the description; when it is missing the payload omits the line and the UI warns), `location` = `where` or `"Auf dem Server"`, `startsAt`/`endsAt` (`endsAt = start + durationMinutes`, default 2 hours when no duration), `image` = the banner as a data URI (≤ 8 MiB; Discord limits it, an oversize banner is skipped with a warning). The **event link** the embed `url` uses is the event docs URL, never the Discord event URL.
- Column `event_request.discordEventId` (Task 1). `event_settings` gains `botStatus` text null (`ok | denied | missing-permissions`) and `botCheckedAt` (set by the job after a call), shown on the settings page as "Bot token: ok / denied (401)".
- `ensureDiscordEvent(deps, request, settings, secrets): Promise<{ url: string } | null>` (called by the `events.post` job before the first send of an **announcement**): returns `null` when no bot token or guild id is set (the details embed card is used); returns the stored event's URL when `discordEventId` exists (never creates a second); otherwise creates it, stores `discordEventId` **immediately** in its own transaction, logs `post`, and returns the URL. A `denied` or `rejected` answer does not block the post: the job logs it, sets `botStatus`, and continues with the details embed (the announcement is more important than the event); the post's `lastError` notes "Discord event could not be created (<status>)". A `retry` waits through the job's normal delayed re-enqueue.
- Job `events.discord-event` `{ requestId, action: "update" | "delete" }` on `QUEUE.deliver` (attempts 3, backoff 10 s):
  - `update`: only when `discordEventId` is set; sends the changed name/description/times/location/image; a `gone` answer (event deleted in Discord) clears `discordEventId` and stops.
  - `delete`: deletes it; `gone` counts as deleted; clears the column.
  - **Enqueued by:** `onDateChanged` (when `startsAt`, `durationMinutes`, `where`, title or docs URL changed and `discordEventId` is set), and `cancelRequest` (when set). Job ids `event-dev-<requestId>-<action>-<minute>`. **Never by anything else**, and never when no bot token is set.
- Announcement test sends and reminder/team/disaster posts never call this module (Review Focus 2 is pinned here again by an import test: `src/worker/jobs/events-post.ts`'s `events.test` and disaster/resolve code paths do not reference `ensureDiscordEvent`).

- [ ] **Step 1: Write failing tests:**
  - `eventPayload`: description contains the docs URL line and is ≤ 1,000 characters; a title of 120 characters is cut to 100; end time = start + duration, default +2 h; location fallback; the Discord event URL is **not** used as the embed url (the details embed `url` equals the docs URL).
  - `discord-bot.test.ts`: create posts `entity_type: 3`, `scheduled_end_time` present, `Authorization: Bot …` header; 401/403 `denied`; 404 `gone`; 429 `retry`; the token never appears in any thrown error or result.
  - `ensureDiscordEvent`: no bot token → `null`, no fetch; first call creates and stores the id (fetch once), second call creates nothing and returns the same URL; a 403 returns `null`, sets `botStatus = "denied"`, and the announcement still posts with the details embed; the stored id survives a later post failure (created event is not created twice on resume).
  - Announcement post with a bot token: the last part is `event-link` with the `https://discord.com/events/<guild>/<event>` URL, sent as its own message; the announcement's first part's ping rules are unchanged.
  - `updateRequest` changing `startsAt` with a stored event id enqueues one `events.discord-event` update job (deduped within the minute); without a stored id nothing is enqueued; `cancelRequest` enqueues `delete` and the job clears the id; `gone` on update clears the id.
  - Import test: the `events.test` job module path and the disaster code path do not import `discord-bot` or `ensureDiscordEvent`.
- [ ] **Step 2: Run** `npx vitest run src/lib/discord-bot.test.ts src/worker/jobs/events-discord-event.test.ts src/worker/jobs/events-post.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, register the job, and show the status line on the request page ("Discord event created for 17 Oct, 20:00" with a link, or "No Discord event: bot token not set").
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(events): create and keep real discord scheduled events in sync`.

### Task 14: Copy-prompts dialog

**Files:**
- Create: `src/lib/event-prompts.ts`, `src/lib/event-prompts.test.ts`, `src/lib/ops/request-prompts.ts`, `src/lib/ops/request-prompts.test.ts`, `src/components/events/copy-prompts-dialog.tsx`
- Modify: the router (`requests.prompts`, `requests.posts.savePasteBack`), the request page header (button "Copy prompts"), `src/lib/ops/request-posts.ts`

**Interfaces:**
- `PromptKind = "announcement" | "reminder" | "team"`.
- `PromptInput`: `{ request: { title; startsAt; durationMinutes; where; eventDocsUrl }; settings: { timeZone; rulebookUrl; announcementStyle; announcementExample; reminderExample; teamStyle; teamExample }; brief: string; answers: { question: string; answer: string }[]` (typed answers rendered as readable text: lists joined with commas, yes/no as `Ja`/`Nein`, scale as `3 von 5`, number with unit, dates in German, not-sure as `Offen, das Team entscheidet`) `; fallback: { title; whatWeDo; whoDecides }[]; moderation: { question; answer }[] }` where `moderation` is the subset of answers from the moderation questions (Task 8's skill marks them by asking with the text prefix `Moderation:`; the filter is `question.startsWith("Moderation:")`).
- `buildPrompts(input): Record<PromptKind, string>` (pure). The three prompts are **generic**: no product names, no mention of any assistant, tool or company; German instructions (the planner works in German) with a fixed structure:
  1. **Announcement prompt** (the big event prompt): role ("Du schreibst die Ankündigung für ein Community-Event"), the saved style guide (or the default text when empty), the example announcement, then a block "Alle Informationen zum Event" with name, date and time and duration (placeholders already filled with real values, German formats), where, the brief, every answer as "Frage: Antwort", the schedule from the answers, rewards, a fallback summary (titles only, with the sentence "Nicht in der Ankündigung nennen, nur zur Information" so the model does not publish the fallback), the event docs link and the rulebook link, then the closing instruction "Schreibe die Ankündigung auf Deutsch. Beginne mit `# <Eventname>`, dann fließender Text in Absätzen, keine Stichpunktlisten, keine Kopie des Briefings." Output rules: plain text, no commentary around it.
  2. **Reminder prompt:** the reminder example, style, essentials only (name, date, time, where, docs, rules, one-sentence summary), instruction to write the short reminder in German in the same style.
  3. **Team prompt:** team style and example, general info, the moderation requirements (staff roles and count, chat rules, what is punished, banned items, who is on call), staffing from the answers, the **full fallback plan** (scenario, what we do, who decides), the docs link and rulebook link; instruction to write the team message in German.
  - Missing data is omitted with its label (never "undefined" or an empty heading); a section with no content is dropped; links appear on their own line.
- `getPrompts(db, actor, requestId): Promise<Record<PromptKind, string>>`: `edit` access (the requester); loads request, settings (style and examples only, **no secret columns are selected**; a test asserts the SELECT list), brief, answers, fallback, to build the prompts. Event managers see them too.
- `savePasteBack(db, actor, requestId, kind: PromptKind, text: string)`: stores the pasted text as the draft of the matching post (`announcement`, `reminder`, `team`) via `savePostDraft` (so it lands in the composer for review and editing, and sends nothing); text ≤ 20,000; an empty paste is `InvalidError`; refused after the post is `posted` (use Edit); logs `post` (`draft pasted`).
- Dialog: three tabs (Announcement, Reminder, Team message), each with a read-only text area showing the prompt, a **Copy** button (clipboard API with a fallback "Select all" for browsers that refuse, toast "Copied"), a one-line instruction ("Paste this into any chat assistant, then paste the text it writes back below."), a **paste-back** textarea with "Save as draft" that calls `savePasteBack`, and a link "Open in Messages" to the composer.

- [ ] **Step 1: Write failing tests:**
  - `buildPrompts` for a fixture contains: the style guide text and both examples, the event name, the filled German date and time (`Samstag, 17. Oktober 2026`, `20:00 Uhr`), `where`, the brief, one `Frage: Antwort` line per answer, the docs and rulebook links, the German closing instruction, and for the announcement prompt the fallback titles with the "nicht nennen" sentence but **not** the `whatWeDo` text; the team prompt **does** contain `whatWeDo` and `whoDecides` and the moderation block; the reminder prompt is shorter than the announcement prompt and has no fallback.
  - Genericity: none of the prompts matches `/claude|anthropic|chatgpt|openai|gpt|roadmap|surf/i`.
  - Typed answer rendering: `yesno` true → `Ja`; `multi` with other → `A, B, Sonstiges: x`; `scale` → `3 von 5`; `number` with unit `Spieler` → `40 Spieler`; not-sure → the German phrase.
  - Empty settings use the default style text; a missing docs URL omits the docs line (no `undefined`, no empty label); an empty moderation list drops the moderation heading.
  - `getPrompts` by a stranger is `NotFoundError`; the settings query selects no `*Enc` column (inspect the query through a spy on the select columns, or assert the function reads settings only through `getEventSettings`-style masked view with the style fields).
  - `savePasteBack` stores into the announcement draft and does not change `status`, `parts` or enqueue anything (`memoryQueue().jobs` empty); empty paste is `InvalidError`; after `posted` it is `ConflictError`.
- [ ] **Step 2: Run** `npx vitest run src/lib/event-prompts.test.ts src/lib/ops/request-prompts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the builder, ops, procedures and dialog.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(events): add the copy-prompts dialog with paste-back drafts`.

### Task 15: Reminders and "never stuck"

**Files:**
- Create: `src/lib/event-work-days.ts`, `src/lib/event-work-days.test.ts`, `src/lib/ops/request-reminders.ts`, `src/lib/ops/request-reminders.test.ts`, `src/worker/jobs/events-reminders.ts`, `src/worker/jobs/events-reminders.test.ts`
- Modify: `src/lib/ops/uploads.ts` (sweep helper used by the job), `src/lib/ops/requests.ts` (`listRequests` flags), `src/app/login/page.tsx`, the request page (banners), `src/components/events/*` (late badges), the worker registration

**Interfaces:**
- `workingDaysBetween(from: Date, to: Date, timeZone: string): number`: whole Monday–Friday days elapsed in `timeZone` (a Saturday and Sunday do not count; no holiday calendar).
- Repeatable job `events.reminders` on `QUEUE.maintenance`, `registerRepeatable(…, { cron: "10 * * * *" })` (hourly at minute 10, UTC), `{ now }` from deps. It **only creates notifications** (through `notifyRequest`, deduped by `sourceKey`; running it twice in a row creates nothing new) and removes orphaned upload files. It never posts, never changes a status, never edits a post, never calls Discord. Per run:
  1. **Pickup:** requests `submitted` for ≥ 2 working days with no developer-side activity (no `request_log` row of field `questions`, `status` or `project` by a developer or admin since `submittedAt`): notify all admins and event developers `request.pickup` (source `req:<id>:pickup:<submittedAt ISO date>`; one reminder per submission, re-sent only after recall and resubmit).
  2. **Waiting on you:** requests with open question rounds: for each round whose oldest unanswered question was asked ≥ 1 day ago, notify the requester `request.waiting` (source `req:<id>:wait:<roundNumber>:d1`); ≥ 3 days ago a second one (`…:d3`), and at the 3-day mark also notify the event managers once (`…:d3m`). Days are 24-hour days (not working days).
  3. **Late to-dos:** an undone to-do with `dueAt` passed: notify the owner (and the requester if different) `request.todo_due` once when it turns late (source `req:<id>:todo:<todoId>:late`) and again 3 days later (`:late3`). To-dos due within the next 24 hours get a single `request.todo_due` heads-up (`:soon`).
  4. **Post due:** an unposted team message, announcement or reminder whose due date passed or is within 24 hours notifies the requester (and managers when overdue) with kind `request.todo_due` (source `req:<id>:post:<kind>:soon|late`). The notification text says "Post the announcement for <event> (due <date>)" and links to the Messages tab. **It does not post.**
  5. **Orphan sweep:** upload files in the volume with no `event_upload` row older than 1 day are deleted (never rows, never referenced files).
  Only requests in `accepted` or `event_week` (and `submitted` for step 1) are considered; `done`, `withdrawn`, `cancelled` and `draft` requests produce nothing.
- Derived flags for the UI: `listRequests` items gain `waitingOnRequester` (open questions) and `lateTodos` (count); the request page shows: a **"Waiting on you"** banner for the requester while questions are open (with the number of open questions and how long they wait), a red **"Late"** badge on to-dos and unposted posts, and on an `event_week` request a **"Something wrong?"** link beside the status bar that jumps to the Event day tab where the fallback scenarios and the disaster button are one click away. Nothing is automated by the flags.
- **Login page:** when a Discord sign-in succeeds but the account is not on the allowlist, the page shows the account's Discord ID with a Copy button and the sentence "Send this ID to an admin to get access." (currently the person gets no way to learn the ID). Admins who are signed in see the same ID under their own profile menu as "Your Discord ID". The ID is read from the Better Auth Discord account record of the rejected sign-in; it is shown only to the person who signed in, never in the URL.
- `src/lib/ops/users.ts` gains nothing; the admin users page has a hint under the "Add account" form: "Ask the person to sign in once; the login page shows their Discord ID."

- [ ] **Step 1: Write failing pure tests:** `workingDaysBetween` for Friday 17:00 → Monday 09:00 (Europe/Berlin) is 0 full working days, Thursday 09:00 → Monday 09:00 is 2, Friday 09:00 → Tuesday 09:00 is 2 (weekend excluded); month and DST boundaries; `from >= to` is 0.
- [ ] **Step 2: Write failing job tests** (`testDeps` with a fixed clock, a stubbed fetch that must never be called):
  - A request submitted 3 working days ago with no developer activity: one `request.pickup` per admin and event developer; a second run creates none; a developer question (`request_log` `questions`) removes the reminder from the next run; one submitted 1 day ago creates none; a weekend does not count.
  - Waiting: a round asked 25 hours ago → `:d1` for the requester only; 73 hours → `:d3` and the managers' `:d3m`; the earlier keys are not duplicated; answering everything stops further reminders.
  - Late to-do: past due → owner and requester notified once, 3 days later a second; an undone to-do due in 12 hours → `:soon`; a done to-do nothing; a `withdrawn` request nothing.
  - Post due: an unposted announcement past due notifies the requester; **no `event_post` row changes, no job is enqueued on `QUEUE.deliver`, and `fetch` is never called** (assert all three); after the post is `posted` nothing is created.
  - The orphan sweep deletes an unreferenced old file and keeps a referenced one and a fresh one.
  - The login page test (component test, or route test of the helper that builds the view model): a rejected account shows the Discord ID; an accepted account does not; the ID text is not in any link href.
  - `listRequests` flags: `waitingOnRequester` true with an open question; `lateTodos` counts only undone past-due to-dos.
- [ ] **Step 3: Run** `npx vitest run src/lib/event-work-days.test.ts src/lib/ops/request-reminders.test.ts src/worker/jobs/events-reminders.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the job, registration, banners, badges and the login page change.
- [ ] **Step 5: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(events): add reminders as notifications and never-stuck banners`.

### Task 16: README, docs and final checks

**Files:**
- Modify: `README.md` (env table gains `EVENT_UPLOADS_DIR`; new section "Event requests" after "GitHub": roles, settings, how posting works, test sends, uploads volume, Discord bot permissions), `.env.example` (verify), the plugin README (the `/surf-roadmap:requests` command)
- Create: `docs/event-requests.md`

**Interfaces:** none (documentation). Required content:
- **README "Event requests":** what a request is and the status flow; the two flags an admin sets on the users page; the event settings page and which fields are admin-only (secrets); that **nothing posts automatically**: every post is a click and reminders are notifications only; the uploads volume (`roadmap-uploads`, `EVENT_UPLOADS_DIR`, no backup needed because files are publish-once; the Dockerfile creates the directory for the `node` user and a bind mount needs `chown 1000:1000`); the Discord setup list: create three webhooks (public announcements, team channel, staff test), the ping role id (Developer Mode → copy role ID), optionally a bot with the **Manage Events** permission and the **Create Events** permission invited to the guild (no gateway, no intents needed), and where to paste each (Event settings); webhook URLs and the bot token are encrypted with `ENCRYPTION_KEY`; message limits and splitting (2,000 characters, split at paragraphs, the card is always its own last message, editing a split post updates every part and never pings); the stalled-post note ("if a post stalls, check the channel, then press Resume; a crash between Discord answering and the database write can repeat one message").
- **`docs/event-requests.md`:** a user guide in three parts: the planner (create, brief, answer questions, upload banner, fallback plan, prep to-dos, copy prompts and paste back, post messages, event day, disaster and resolve), the developer (accept, create vs link, brief changed, `/surf-roadmap:requests`, never delete done work), the admin (flags, settings, secrets, bot, volume, troubleshooting: webhook answered 404, post stuck `partial`, Discord event denied, uploads folder not writable). Placeholders table (`{event}` … `{note}`), template examples in German, the permission matrix (requester, event manager, event developer, admin, project member, staff on event day), and an "Out of scope" list (no automatic posts, no Claude calls from the app).

- [ ] **Step 1: Write the docs** as above. Every env var, route and button named exists in the code (check each name by grep before writing it).
- [ ] **Step 2: Run** `npm run lint && npm run typecheck && npm test && npm run test:plugin && npm run build`. Expected: PASS.
- [ ] **Step 3: Verify the whole flow in the browser** with `npm run dev`, the dev worker running, two seeded users (manager/requester and developer/admin) and a throwaway Discord server with three webhooks:
  1. Admin sets the flags and the secrets; a manager opens Event settings and sees only masked values.
  2. Manager creates a request, uploads a banner, submits; developer is notified, asks a round of mixed-type questions through the tool; the requester answers one with "Not sure".
  3. Developer accepts with "Create project"; the project shows deadline and spec v1; the requester sees the progress bar move after tasks are marked done.
  4. Requester edits the brief; the project shows "Brief changed since spec v1"; the diff opens.
  5. Fill the three fallback scenarios, start event week.
  6. Test-send the announcement (staff channel only, no ping, no Discord event); post it (ping once, event card last); edit it (no ping, ids updated); post the team message; post the disaster message and resolve it with a note.
  7. Confirm no message or event appeared without a click.
- [ ] **Step 4: Commit** `docs(events): document event requests setup and use`.

---

## Self-review notes for the executor

- Every decision of the decisions file maps to a task: model and statuses (1, 2), accept and link (7), brief versions and "Brief changed" (2, 8), roles and permissions (1), secrets masked (10), event settings including all templates and placeholders (10, 11), messages and splitting (11), edit/delete (12), real Discord event (13), test sends (12), disaster and resolved (12), prompts (14), typed questions and the moderation area (5, 6, 8), fallback (9), prep and event day (9), uploads (4), never stuck (15), out of scope respected (no automatic actions anywhere; the only repeatable job creates notifications).
- Names used across tasks and to keep identical: `requestAccess`, `eventFlags`, `canAcceptRequests`, `logRequest`, `onDateChanged`, `notifyRequest`, `canViewRequest`, `askedQuestionInput`, `answerValueSchema`, `acceptRequest`, `requestProgress`, `recordSpecBasis`, `briefStatus`, `fallbackReady`, `ensurePrepTodos`, `dueFor`, `loadEventSecrets` (worker only), `fillPlaceholders`, `plannedParts`, `splitText`, `startPost`, `resumePost`, `editPost`, `deletePost`, `testSend`, `postDisaster`, `resolveDisaster`, `ensureDiscordEvent`, `buildPrompts`, job names `events.post`, `events.edit`, `events.delete`, `events.test`, `events.resolve`, `events.discord-event`, `events.reminders`, and the job id patterns `event-post-<id>-<n>`, `event-edit-…`, `event-test-…`, `event-dev-…` (no `:`).
- `request_log` exists because `change_log.project_id` is `NOT NULL` and requests live outside projects. Consumers of the change feed (notifications, Discord project webhooks) are therefore unaffected by request activity; request notifications are created directly by ops and the reminder job.
- The notification table change in Task 3 (nullable `projectId`, `requestId`) touches v2 code (`listNotifications`, the dispatcher, `push.send`); keep the existing tests unchanged and green as the proof.
- Part 9 (realtime, German UI) is still to come: it must add the `requests` router to its channel map and move the English UI literals of these pages into message files, while Discord post texts stay German literals in `src/lib/event-messages.ts` and `src/lib/event-prompts.ts` (they are content, not interface).
- The tool-list budget is the one global limit this plan can break: Task 6 states the measure-first rule and caps any raise.

## Open points (decisions to confirm; the plan picked the stated default)

1. **"Update from brief" button:** the app cannot run an agent, so the button shows a copyable `/surf-roadmap:requests update <id>` instruction instead of running anything (Task 8).
2. **Who can create requests:** event managers and admins create (the decisions list "creates requests" under event manager); the requester defaults to the creator and a manager may name another user. Users without a flag can only be requesters of requests a manager made for them.
3. **Draft visibility:** developers and project members see a request only after `submitted`; drafts are visible to the requester, event managers and admins.
4. **Project deadline and "Event" template do not exist yet:** Task 7 adds `project.deadline` and a code-defined `EVENT_TEMPLATE` (Event board, three phases, one domain); there is no project-template feature in the repo.
5. **Requester is not added to the project** on accept; the progress bar (counts only) is their view of the build. Adding them as a viewer later would expose task titles.
6. **Linking to an existing system writes no spec** (the banner then reads "Brief not applied yet"); only "create" writes spec v1 from the brief. Spec basis is recorded via the new optional `write_spec.brief` input.
7. **Settings changes have no history:** `event_settings` records only `updatedBy`/`updatedAt` (no request, so no `request_log`, and an audit table was not asked for). Say if an audit trail is wanted.
8. **Time zone:** the decisions give no time zone for `{time}` and to-do due times; the plan adds `event_settings.timeZone` (default `Europe/Berlin`) and 09:00 local for to-do due times.
9. **Staff on event day:** "staff check in themselves" implies a non-requester can open the event-day page; the plan lets any signed-in user open that one page (checklist read-only, fallback, check-in) during `event_week` and nothing else.
10. **Prompt language:** the three prompts are written in German (planner and posts are German) although the UI is English until Part 9.
11. **A crash between Discord's answer and the database write** can repeat one message when the job retries (Discord webhooks cannot de-duplicate); the plan limits this to one part, shows "check the channel before resuming" and documents it, but cannot remove it.
12. **No list tool for requests:** `/surf-roadmap:requests` without an id asks the user for it (adding a `list_requests` tool would cost tool-list budget); say if a third tool is acceptable.
13. **Moderation questions** are recognised by the text prefix `Moderation:` for the team prompt; a dedicated question `tag` field would be cleaner but adds schema bytes to `ask_requester`.
14. **Date-driven side effects** (re-dating template to-dos, updating the Discord event and project deadline when the date is edited) run as direct consequences of a person's edit, not on a schedule; confirm this counts as "not automatic".
