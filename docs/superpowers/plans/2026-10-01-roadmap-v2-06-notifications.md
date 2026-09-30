# roadmap-app v2 Part 6: Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell people about what concerns them: an in-app notification center, @mentions, a Discord channel per project, and Web Push to each person's browsers and phones, all governed by personal rules.

**Architecture:** One `notification` table is the source of truth. Rows are created by `notify(tx, input)`, either inside an op's transaction (mentions) or by the `notifications` change-feed consumer in the worker, which maps `change_log` entries to recipients with the fixed rules in Task 4. A repeatable `notifications.dispatch` job turns pending rows into Web Push jobs, applying each person's rules, quiet hours and "active in the app" state at send time. Discord is separate and per project: the `discord` feed consumer writes `discord_outbox` rows, and delayed `discord.flush` jobs batch them into one message per burst. Web requests never call Discord or a push service.

**Tech Stack:** as the index, plus `web-push` 3 (worker only) and Node's `crypto` (AES-256-GCM).

**Spec:** none for v2. Read `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` first (Global Constraints, Shared names, Review Focus), and the 2026-09-29 spec for everything v2 leaves alone.

**Assumes from earlier parts** (use these exact names; if one differs in the repo, adapt to the repo and note it in the commit body):
- Part 1: `registerFeedConsumer(name, handle)`, `ChangeEvent`, `registerJob(queue, jobName, handle)`, `registerRepeatable(queue: QueueName, jobName, schedule: { everyMs: number } | { cron: string }, data?)` (the job is also registered with `registerJob`), `WorkerDeps`, `QUEUE`, `JobQueue`, `memoryQueue()`, `Kv`, `memoryKv()`, `getPref(db, userId, key)` / `setPref(db, userId, key, value)` in `src/lib/ops/prefs.ts`, and `valkeyKv()` from `src/lib/kv.ts` for the web process's `Kv` (tRPC procedures that need Kv take it from `valkeyKv()`; tests pass `memoryKv()`).
- Part 2: `project.archivedAt` (nullable timestamp), `task.notes` (text), `question.priority` (`blocking` | `normal` | `nice`).
- Part 3: `myWork(db, actor)` in `src/lib/ops/my-work.ts` returning `MyWorkItem[]`, with a discriminated `kind` field.
- Part 0: `keepAnOwner` and `listMembers` ignore removed accounts; `isMember(db, projectId, userId)` already joins `allowed_account`.

Neither "follow a system" nor "ask a specific person" is part of v2. Recipients come only from ownership, authorship and mentions. Do not add followers or addressees.

## Global Constraints

- All of the index's Global Constraints apply.
- `ENCRYPTION_KEY` becomes **required** in this part: 32 random bytes as base64 (`openssl rand -base64 32`). Add it to `REQUIRED` in `src/instrumentation.ts`, to the worker's start check, to `.env.example` (with that command in the comment), to both compose files and to the README table.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` are optional **as a set**. If any is missing, push is off: the device section of the settings page says "Push notifications are not set up on this server. An admin sets VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT." and the dispatcher marks pending rows `skipped`. `VAPID_SUBJECT` is a `mailto:` or `https:` URL. README documents `npx web-push generate-vapid-keys`.
- New change-log entity names: `webhook` (project webhooks; fields `created`, `deleted`, `events`, `boards`, `enabled`). Notifications themselves are never written to `change_log`.
- Notification copy is short. The title is at most 80 characters and names the thing ("Jules answered your question"); the body is at most 140 characters of plain text with mention tokens turned into `@Name`.
- The actor never notifies themselves (Task 4 lists the one exception, for their own agents).
- Every recipient passes `canReceive` (Task 2) at creation **and** again at delivery time.

## Review Focus

1. **A recipient who lost access between the change and the delivery** (removed from the project, account removed from the allowlist, project archived): no inbox row is created. A row that already exists is marked `skipped` and never pushed. Pinned in Task 2 (`canReceive` tests) and Task 9 (dispatch re-check test).
2. **A mention of someone who is not a project member**, or a name that matches two members: nobody is notified, and the text stays as the author wrote it. Pinned in Task 1 (`resolveMentions` tests).
3. **The same change-log entry is processed twice** (feed retry, worker restart): each recipient gets one notification and Discord gets one embed. Pinned in Task 4 (`notification_source_unique`) and Task 7 (`discord_outbox_unique`).
4. **A Discord webhook that was deleted on Discord's side** (404/401), or one that keeps answering 429: 404/401 disables the webhook with a visible error and stops retries; 429 waits `retry_after` and does not lose rows. Pinned in Task 8.
5. **A push subscription the browser revoked** (push service answers 404 or 410): the subscription row is deleted and the notification counts as delivered to the person's other devices. A payload over the size limit is truncated, never rejected. Pinned in Task 10.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/mentions.ts` | Mention token format: parse, format, strip to plain text, resolve `@Name` to tokens (pure) |
| `src/lib/ops/mentions.ts` | `resolveMentionsIn(tx, projectId, text)` and `notifyMentions(tx, actor, …)`, used by content ops |
| `src/db/schema/notifications.ts` | `notification`, `push_subscription`, `project_webhook`, `discord_outbox` tables |
| `src/lib/ops/notifications.ts` | `notify`, `canReceive`, inbox ops (list, unread count, mark read), `NOTIFICATION_KINDS` |
| `src/lib/ops/notify-rules.ts` | `notify.rules` pref schema, defaults, `wantsInbox`, `pushDecision` (pure) |
| `src/worker/consumers/notifications.ts` | change feed → `notify` calls |
| `src/worker/jobs/dispatch.ts` | `notifications.dispatch`: pending rows → `push.send` jobs |
| `src/lib/crypto.ts` | `encryptSecret` / `decryptSecret` (AES-256-GCM with `ENCRYPTION_KEY`) |
| `src/lib/ops/webhooks.ts` | project webhook ops (owner) |
| `src/worker/consumers/discord.ts` | change feed → `discord_outbox` rows + flush jobs |
| `src/worker/jobs/discord.ts` | `discord.flush`, `discord.test`, `digest.weekly` |
| `src/lib/discord-format.ts` | builds embeds from outbox payloads and digests (pure) |
| `src/lib/ops/push.ts` | subscription ops |
| `src/worker/jobs/push.ts` | `push.send`, `push.test` using `web-push` |
| `public/sw.js` | service worker: `push`, `notificationclick` |
| `src/server/trpc/routers/notifications.ts` | inbox, rules, heartbeat, devices |
| `src/server/trpc/routers/webhooks.ts` | project webhooks |
| `src/components/mentions/*` | `MentionTextarea`, `MentionChip` |
| `src/components/notifications/*` | bell, list, settings sections, push enable flow |
| `src/app/(app)/(global)/notifications/page.tsx` | full inbox |
| `src/app/(app)/(global)/settings/notifications/page.tsx` | personal rules and devices |
| `src/app/(app)/p/[project]/settings/notifications/page.tsx` | project Discord webhooks (owner) |

---

### Task 1: Mention tokens and name resolution

**Files:**
- Create: `src/lib/mentions.ts`, `src/lib/mentions.test.ts`
- Create: `src/lib/ops/mentions.ts`, `src/lib/ops/mentions.test.ts`

**Interfaces:**
- Consumes: `listMembers`-style member query (write a small internal query: members of the project joined to `user` and `allowed_account`, returning `{ userId, name }`).
- Produces:
  - `MENTION_RE`: global regex for a stored token, `/\[@([^\]\n]{1,64})\]\(user:([0-9a-f-]{36})\)/g`.
  - `formatMention(name: string, userId: string): string`, which returns `[@Name](user:<id>)`. It strips `]`, `[` and newlines from the name.
  - `parseMentions(text: string): { userId: string; name: string }[]`, unique by `userId`, in order of first appearance.
  - `mentionsToPlain(text: string): string`, which replaces every token with `@Name`.
  - `newMentions(before: string | null, after: string): string[]`: the user ids in `after` that are not in `before`.
  - `resolveMentionNames(text: string, members: { userId: string; name: string }[]): string`, the pure resolver.
  - `resolveMentionsIn(tx: Executor, projectId: string, text: string): Promise<string>`, which loads the project's members and calls the pure resolver.
  - `notifyMentions(tx: Executor, actor: Actor, input: { projectId: string; before: string | null; after: string; title: string; href: string; source: string }): Promise<void>`, which calls `notify` (Task 2) with kind `mention` for each id from `newMentions`, excluding `actor.userId`. `source` becomes `sourceKey` (Task 2) as `${source}:mention:${userId}`.

The stored format is a normal markdown link, so it renders even without the chip component, and any text containing it is still valid markdown. Agents and the UI both work:
- **UI:** the `MentionTextarea` (Task 5) inserts tokens directly.
- **Agents and plain text:** ops call `resolveMentionsIn` before saving. It turns `@Name` into a token when `Name` matches exactly one current member, case-insensitively.
  - Candidate names are tried longest first, so `@Jules Laurent` beats `@Jules`.
  - A match needs a word boundary after the name: the end of the text, whitespace, or one of `.,;:!?)`.
  - Text inside backticks (inline code or fenced blocks) is never resolved.
  - `@` preceded by a letter or digit (an email address) is ignored.
  - An existing token is left alone.
  - A name that matches two members, or no member, stays as written.

- [ ] **Step 1: Write the failing pure tests** in `src/lib/mentions.test.ts`. Use members `[{ userId: A, name: "Jules" }, { userId: B, name: "Jules Laurent" }, { userId: C, name: "Rik" }, { userId: D, name: "rik" }]`, where A–D are fixed UUID strings:
  - `formatMention("Ri]k\n", C)` returns `[@Rik](user:C)`.
  - `parseMentions("hi [@Rik](user:C) and [@Rik](user:C)")` returns one entry.
  - `mentionsToPlain("ping [@Jules](user:A).")` returns `"ping @Jules."`.
  - `newMentions("[@Jules](user:A)", "[@Jules](user:A) [@Rik](user:C)")` returns `[C]`; `newMentions(null, "[@Jules](user:A)")` returns `[A]`.
  - `resolveMentionNames("@Jules Laurent can you check", members)` returns the token for B, not A.
  - `resolveMentionNames("@Jules, please", members)` returns the token for A.
  - `resolveMentionNames("@rik look", members)` is unchanged (two members match case-insensitively).
  - `resolveMentionNames("mail me at a@Jules.dev", members)` is unchanged.
  - `resolveMentionNames("run `@Jules` literally", members)` is unchanged.
  - `resolveMentionNames("@Nobody hi", members)` is unchanged.
  - `resolveMentionNames("[@Jules](user:A) and @Jules", members)` has exactly two tokens.
- [ ] **Step 2: Run** `npx vitest run src/lib/mentions.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/mentions.ts` as pure functions with no imports from `@/db`. For backticks, split the text on fenced blocks and inline code spans first and resolve only the plain segments.
- [ ] **Step 4: Write the failing op test** in `src/lib/ops/mentions.test.ts`:
  - Use `createProjectFixture` plus `addMemberFixture(…, "editor")` named "Jules" (pass `name` through `insertUser` if the fixture can't; extend `addMemberFixture` with an optional `name` argument).
  - `resolveMentionsIn(db, projectId, "@Jules hi")` contains `user:<julesId>`.
  - After the admin removes Jules's account from `allowed_account`, the same call returns the text unchanged.
  - A user who is not a member is never resolved.
- [ ] **Step 5: Implement** `src/lib/ops/mentions.ts`. `notifyMentions` stays a thin wrapper and is completed in Task 2, so write its test there.
- [ ] **Step 6: Run** `npx vitest run src/lib/mentions.test.ts src/lib/ops/mentions.test.ts`. Expected: PASS.
- [ ] **Step 7: Commit** `feat(mentions): add mention tokens and member name resolution`.

### Task 2: Notification table, `notify`, recipient filter and inbox ops

**Files:**
- Create: `src/db/schema/notifications.ts` (export from `src/db/schema/index.ts`)
- Create: `src/lib/ops/notifications.ts`, `src/lib/ops/notifications.test.ts`
- Modify: `src/lib/ops/mentions.ts` (finish `notifyMentions`), `src/lib/ops/mentions.test.ts`
- Generated: `drizzle/00xx_notifications.sql` via `npm run db:generate -- --name notifications`

**Interfaces:**
- Produces:
  - `NOTIFICATION_KINDS = ["mention", "question.answered", "question.asked", "planning.round", "system.assigned", "task.assigned", "task.blocked", "system.blocked", "system.done", "adr.proposed", "update.posted"] as const` and `type NotificationKind`.
  - Table `notification`:
    - `id` text pk (`newId()`)
    - `userId` text not null, FK `user.id` on delete cascade
    - `projectId` text not null, FK `project.id` on delete cascade
    - `kind` text enum `NOTIFICATION_KINDS` not null
    - `entity` text not null
    - `entityId` text not null
    - `title` text not null
    - `body` text not null default `""`
    - `href` text not null (an app-relative path starting with `/p/`)
    - `actorName` text null (e.g. "Claude Code for Ammo")
    - `sourceKey` text not null, and unique `notification_source_unique` on (`userId`, `sourceKey`)
    - `inInbox` boolean not null default true
    - `pushStatus` text enum `["pending", "sent", "skipped", "failed"]` not null default `pending`
    - `createdAt` timestamptz default now
    - `readAt` timestamptz null
    - Indexes on (`userId`, `createdAt` desc) and (`pushStatus`, `createdAt`).
  - `NotifyInput`: `{ userId: string; projectId: string; kind: NotificationKind; entity: string; entityId: string; title: string; body?: string; href: string; actorName?: string | null; sourceKey: string }`.
  - `canReceive(tx, userId, projectId): Promise<boolean>`. True when the project is not archived (`project.archivedAt` is null) **and** `isMember(tx, projectId, userId)` holds. Admins who are not members get nothing.
  - `notify(tx: Executor, input: NotifyInput): Promise<boolean>`:
    - Returns false and inserts nothing when `canReceive` is false.
    - Otherwise reads `notify.rules` (Task 3 `wantsInbox`) and inserts with `inInbox` set from the rules. `readAt` is set to now when `inInbox` is false, so the row never counts as unread.
    - `pushStatus` is `pending` when the rules allow push for the kind, otherwise `skipped`.
    - Uses `onConflictDoNothing` on `notification_source_unique` and returns whether a row was inserted.
    - Truncates `title` to 80 and `body` to 140 characters (ending with `…`) and runs `mentionsToPlain` on both.
  - `listNotifications(db, actor, input: { before?: string; limit?: number }): Promise<NotificationItem[]>`: newest first, only `inInbox = true`, and only projects the actor can still see (join through `isMember` semantics). Default limit 30, max 100. `before` is a notification id used as a cursor.
  - `unreadCount(db, actor): Promise<number>`, which counts the same visible set with `readAt is null`, capped at 99.
  - `markRead(db, actor, ids: string[])` only touches the actor's own rows. `markAllRead(db, actor)`.
  - `NotificationItem`: `{ id, kind, title, body, href, actorName, projectSlug, projectName, createdAt, readAt }`.

- [ ] **Step 1: Write the schema** as above, with doc comments on every table and column group. Run `npm run db:generate -- --name notifications`, then `npm test` to prove the migration applies.
- [ ] **Step 2: Write failing tests** in `src/lib/ops/notifications.test.ts`:
  1. Owner, editor member E and a non-member N. `notify(db, { userId: E, …, sourceKey: "cl:1" })` returns true; `listNotifications(E)` has one row; `unreadCount(E)` is 1.
  2. Calling `notify` again with the same `sourceKey` returns false and leaves one row.
  3. `notify` for N returns false and leaves no row.
  4. Delete E's `allowed_account` row: `notify` for E returns false. The earlier row no longer appears in `listNotifications(E)` or `unreadCount(E)`.
  5. Set `project.archivedAt = now()`: `notify` for the owner returns false.
  6. `markRead(E, [id-of-owner-row])` changes nothing on the owner's row; `markRead(E, [E's id])` sets `readAt`; `markAllRead` clears the count.
  7. A title of 120 characters is stored as 80 characters ending with `…`; the body `"hi [@Rik](user:C)"` is stored as `"hi @Rik"`.
  8. `unreadCount` is 99 when 150 rows are unread.
  9. Pagination: 35 rows; the first page has 30; `before: page1.at(-1).id` returns the remaining 5.
- [ ] **Step 3: Run** `npx vitest run src/lib/ops/notifications.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** `src/lib/ops/notifications.ts`. Rules are read through `wantsInbox` and `wantsPush` from Task 3. Until Task 3 lands, write them in `src/lib/ops/notify-rules.ts` as stubs that return `true`, and let Task 3 replace them.
- [ ] **Step 5: Finish `notifyMentions`** and add tests to `src/lib/ops/mentions.test.ts`:
  - `notifyMentions(tx, owner, { before: null, after: "[@E](user:E) [@Owner](user:owner)", … })` creates one row, for E only: the author is skipped.
  - Calling it again with `before` equal to the same text creates nothing.
- [ ] **Step 6: Wire mentions into content ops.** In each op below, call `resolveMentionsIn` on the text before saving, then `notifyMentions` in the same transaction with the old and new values:
  - `addQuestion` (`text`)
  - `answerQuestion` (`answer`)
  - `postUpdate` (`summary`, `nextStep`)
  - `updateSystem` (`notes`)
  - `updateTask` (`notes`, from Part 2)
  - `answerPlanningItems` (each `answer`)

  The `href` for each:
  - a question: `/p/<slug>/questions#q-<id>` (if the questions page lacks `id="q-<id>"` anchors on cards, add them to `QuestionCard`)
  - an update or notes: `/p/<slug>/systems/<system>`
  - a task: `/p/<slug>/systems/<system>#task-<id>`
  - planning: `/p/<slug>/systems/<system>?tab=planning`

  The `source` for each: `question:<id>:text`, `question:<id>:answer`, `update:<id>`, `system:<id>:notes`, `task:<id>:notes`, `planning:<itemId>`.

  Add one test per op to that op's existing test file: `@Jules` in the input is stored as a token, and Jules has one `mention` notification.
- [ ] **Step 7: Run** `npm test`. Expected: PASS.
- [ ] **Step 8: Commit** `feat(notifications): add notification rows, recipient checks and mentions in content`.

### Task 3: Personal notification rules

**Files:**
- Modify: `src/lib/ops/notify-rules.ts` (replace the stubs), create `src/lib/ops/notify-rules.test.ts`

**Interfaces:**
- Consumes: `getPref`, `setPref` (Part 1), `NOTIFICATION_KINDS`.
- Produces:
  - `notifyRulesSchema` (zod):

    ```
    {
      kinds: Record<NotificationKind, { inbox: boolean; push: boolean }>,
      quiet: { enabled: boolean; start: "HH:MM"; end: "HH:MM"; timeZone: string },
      skipPushWhileActive: boolean
    }
    ```

    `timeZone` must satisfy `Intl.DateTimeFormat(undefined, { timeZone })` without throwing.
  - `DEFAULT_NOTIFY_RULES`:
    - inbox is true for every kind
    - push is true for `mention`, `question.answered`, `question.asked`, `planning.round`, `task.blocked`, `system.blocked` and `task.assigned`, and false for the rest
    - `quiet = { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" }`
    - `skipPushWhileActive: true`
  - `readNotifyRules(tx, userId): Promise<NotifyRules>`: the stored pref merged over the defaults per kind, so kinds added later default correctly. An invalid stored value falls back to the defaults.
  - `wantsInbox(rules, kind): boolean` and `wantsPush(rules, kind): boolean`.
  - `inQuietHours(rules, now: Date): boolean`, which works across midnight (22:00–08:00) and uses the local time of `rules.quiet.timeZone`.
  - `pushDecision(rules, kind, now, isActive: boolean): "send" | "skip" | "later"`: `skip` when push is off for the kind; `later` when in quiet hours; `skip` when `skipPushWhileActive && isActive`; otherwise `send`.
  - `quietEndsAt(rules, now): Date`, the next instant quiet hours end.
  - `activeKey(userId) = "active:" + userId` in `Kv`, with a TTL of 90 seconds.

- [ ] **Step 1: Write failing tests:**
  - an unset pref gives the defaults
  - a stored `{ kinds: { mention: { inbox: true, push: false } } }` merges, so `mention.push` is false and `question.asked.push` is true
  - junk stored (`"x"`) gives the defaults
  - with quiet 22:00–08:00 Europe/Berlin, `inQuietHours` is true at `2026-10-01T21:30:00Z` (23:30 in Berlin) and false at `2026-10-01T07:30:00Z` (09:30 in Berlin)
  - `pushDecision` returns `later` inside quiet hours, `skip` when active, `send` otherwise, and `skip` for `update.posted` with default rules
  - `quietEndsAt` at 23:30 Berlin is 08:00 Berlin the next day
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/notify-rules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Get local hours and minutes with `Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })`. Don't add a date library.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notifications): add personal notification rules and quiet hours`.

### Task 4: Change-feed consumer that creates notifications

**Files:**
- Create: `src/worker/consumers/notifications.ts`, `src/worker/consumers/notifications.test.ts`
- Modify: the worker's consumer registration list (Part 1's `src/worker/main.ts`, or the module that imports consumers)

**Interfaces:**
- Consumes: `registerFeedConsumer`, `ChangeEvent`, `WorkerDeps`, `notify`.
- Produces: `handleNotificationEvents(events: ChangeEvent[], deps: WorkerDeps): Promise<void>`, registered as the consumer `notifications`.

Rules, applied in one transaction per event. `sourceKey` is always `cl:<event.id>`. `actorName` is the author's name, or `"<agent> for <name>"` when `agent` is set:

| Event (`entity` / `field`) | Recipient | Kind | Title | href |
| --- | --- | --- | --- | --- |
| `question` / `answer` (newValue not null) | the question's `authorUserId` | `question.answered` | `<actor> answered your question` | `/p/<slug>/questions#q-<id>` |
| `question` / `created` with `systemId` | the system's current `ownerUserId` | `question.asked` | `New question on <system title>` (`Blocking question on …` when `question.priority = "blocking"`) | same |
| `planning` / `round` | the system owner | `planning.round` | `Planning questions on <system title>` | `/p/<slug>/systems/<system>?tab=planning` |
| `system` / `owner` (newValue not null) | the system's current owner, only if the owner's name equals `newValue` | `system.assigned` | `You own <system title>` | `/p/<slug>/systems/<system>` |
| `task` / `owner` (newValue not null) | the task's current owner, with the same name check | `task.assigned` | `Task #<id> is yours: <title>` | `/p/<slug>/systems/<system>#task-<id>` |
| `task` / `state` newValue `blocked` | the system owner, and the task owner if different | `task.blocked` | `Task #<id> is blocked` | same as task |
| `system` / `column` | the system owner | `system.blocked` when the system's current column category is `blocked`; `system.done` when it is `done`; otherwise nothing | `<system title> is blocked` / `<system title> is done` | system page |
| `adr` / `created` | the owners of every system linked through `adr_system` | `adr.proposed` | `ADR-<nnnn> proposed: <title>` | `/p/<slug>/adrs/<number>` |
| `update` / `posted` | the system owner | `update.posted` | `Update on <system title>` | system page |

- **Current state:** read the entity's current state from the database: owner, column category (confirm the current column's name equals the column part of `newValue`, `"<board> / <column>"`), and question priority. If the entity is gone or the check fails, skip the event.
- **Self rule:** never notify `event.authorUserId`, with one exception. When `event.agent` is set and the kind is in `SELF_AGENT_KINDS = ["question.asked", "planning.round", "task.blocked", "system.blocked"]`, the author is notified too, because their own agent needs them.
- Events for any other entity or field are ignored.
- Batch lookups: load all needed systems, tasks and questions for the whole batch with `inArray` queries, not one query per event.

- [ ] **Step 1: Write failing tests.** Build `ChangeEvent`s by running real ops, then read the rows back from `change_log`, and call `handleNotificationEvents(events, { db, kv: memoryKv(), queue: () => memoryQueue(), bus: memoryBus(), now: () => new Date() })`. One test per table row, plus:
  - the owner answering their own question creates nothing
  - an agent actor (`{ …owner, agent: "Claude Code" }`) asking a question on the owner's own system notifies the owner (the self rule exception)
  - handling the same events twice leaves one row per recipient (Review Focus 3)
  - a `system/column` event whose system has since moved to another column creates nothing
  - a removed member gets nothing
  - 50 events are handled with at most 10 queries: wrap `db` in a counting proxy, or assert on timing-independent behaviour by checking that the helper `loadContext` is called once per batch; pick the proxy
- [ ] **Step 2: Run** `npx vitest run src/worker/consumers/notifications.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the mapping as a table of small functions keyed by `${entity}/${field}`.
- [ ] **Step 4: Register** the consumer in the worker entry.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(notifications): turn change-log entries into notifications`.

### Task 5: Notification center, mention picker and chips in the UI

**Files:**
- Create: `src/server/trpc/routers/notifications.ts`, register it as `notifications` in `src/server/trpc/router.ts`, and add tests to `src/server/trpc/router.test.ts`
- Create: `src/components/notifications/bell.tsx`, `src/components/notifications/notification-list.tsx`
- Create: `src/app/(app)/(global)/notifications/page.tsx` and `notifications-view.tsx`
- Create: `src/components/mentions/mention-textarea.tsx`, `src/components/mentions/mention-chip.tsx`
- Modify: `src/components/markdown.tsx`, `src/components/shell/app-sidebar.tsx`, `src/components/shell/app-shell.tsx` (mobile top bar), the textareas listed in Step 6, `src/lib/ops/my-work.ts` and its test
- Add the shadcn `popover` (already present) and `badge` (if missing) components with `npx shadcn@latest add badge`

**Interfaces:**
- tRPC `notifications`:
  - `list({ before?, limit? })` → `NotificationItem[]`
  - `unread()` → `number`
  - `markRead({ ids })`, `markAllRead()`
  - `members({ project })` → `{ userId, name, image }[]`, the mention picker source. Any member may read it; it reuses the Part 0 member query that ignores removed accounts.
- `MentionTextarea` props: the props of `Textarea` plus `projectSlug: string`, `value: string`, and `onValueChange(value: string)`.
  - Typing `@` followed by letters opens a popover anchored under the textarea, listing matching members with the shadcn `Command`.
  - Arrow keys pick, and Enter or Tab inserts `formatMention(name, id)` followed by a space. Escape closes the list without inserting.
  - The textarea keeps focus throughout.
- `Markdown` gets a `urlTransform` that keeps `user:` hrefs. Its `a` renderer draws `<MentionChip name userId />` for `user:` links, as a square `bg-brand-soft text-brand-strong` pill reading `@Name` that is not a link.
- `myWork` gains items of `kind: "mention"`: unread `mention` notifications from the last 14 days, `{ kind: "mention", id, title, href, createdAt }`.

- [ ] **Step 1: Write failing router tests:**
  - `unread` for a user with two rows is 2
  - `markRead` with another user's id leaves that row unread
  - `members` for a viewer returns the members
  - `members` for a non-member fails with `NOT_FOUND`
- [ ] **Step 2: Implement the router** and run `npx vitest run src/server/trpc/router.test.ts`. Expected: PASS.
- [ ] **Step 3: Write the failing markdown test** in `src/components/markdown.test.tsx`:
  - rendering `hi [@Rik](user:0190…)` produces an element with text `@Rik` and no `href`
  - `[x](javascript:alert(1))` still has its href removed (the existing guarantee)
- [ ] **Step 4: Implement** `MentionChip` and the `Markdown` change. Run the test. Expected: PASS.
- [ ] **Step 5: Build the bell.**
  - It shows a `Bell` icon with an unread badge (hidden at 0, `99+` above 99). It sits in the sidebar header next to the search button, and in the mobile top bar before Search.
  - Its accessible name is `Notifications, 3 unread`.
  - It opens a `Popover` with the latest 10 rows (title, project name, relative time from the shared clock, a bold dot when unread) and footer links "Mark all read" and "See all".
  - Clicking a row marks it read and navigates to `href`.
  - `unread` refetches every 60 s with `refetchInterval` while the tab is visible. Part 9 replaces this with live events.
- [ ] **Step 6: Replace the textareas** of these forms with `MentionTextarea`:
  - question text in `ask-question-dialog.tsx`
  - answers in `question-card.tsx`
  - system notes in `system-editor.tsx` (the notes field)
  - the update form, wherever `postUpdate` is called from the UI
  - task notes (Part 2)
  - planning answers in `planning-rounds.tsx`

  Keep their labels and validation as they are.
- [ ] **Step 7: Build the full inbox** at `/notifications`, a global route. It has the same list with infinite loading via `before`, a filter tab "Unread / All", and "Mark all read". It appears in the user menu as "Notifications".
- [ ] **Step 8: Add mentions to `myWork`**, with a test in its test file: an unread mention appears, and a read one does not.
- [ ] **Step 9: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 10: Check it in the browser** with `npm run dev`: mention a second seeded user in a question, then sign in as them (or query the table) and confirm the bell shows 1.
- [ ] **Step 11: Commit** `feat(notifications): add the notification bell, inbox page and mention picker`.

### Task 6: Personal notification settings and the activity heartbeat

**Files:**
- Create: `src/app/(app)/(global)/settings/notifications/page.tsx` and `notifications-settings-view.tsx`, `src/components/notifications/rules-table.tsx`, `src/components/notifications/quiet-hours.tsx`, `src/hooks/use-activity-heartbeat.ts`
- Modify: `src/server/trpc/routers/notifications.ts` (add `rules`, `setRules`, `heartbeat`), the user menu (`user-area.tsx`: "Notification settings"), and the root `(app)/layout.tsx` or `AppShell` to mount the heartbeat

**Interfaces:**
- `notifications.rules()` → `NotifyRules`; `notifications.setRules(notifyRulesSchema)` saves the pref.
- `notifications.heartbeat()` sets `activeKey(actor.userId)` to `"1"` with a 90 s TTL through the web process's `Kv`.
- `useActivityHeartbeat()` calls `heartbeat` on mount and every 60 s while `document.visibilityState === "visible"`, and again on `visibilitychange` to visible. It never runs during server render.

- [ ] **Step 1: Write failing router tests:**
  - `setRules` with an unknown time zone fails with `BAD_REQUEST`
  - `setRules` then `rules` round-trips
  - `heartbeat` writes `active:<id>` to the `memoryKv` injected in the test context (extend the tRPC test context with `kv` if Part 1 did not)
- [ ] **Step 2: Implement the procedures** and run the tests. Expected: PASS.
- [ ] **Step 3: Build the settings page:**
  - A rules table with one row per kind, using a human label per kind:
    - `mention`: "Someone mentions me"
    - `question.answered`: "My question is answered"
    - `question.asked`: "A question is asked on my system"
    - `planning.round`: "Planning questions on my system"
    - `system.assigned`: "I become owner of a system"
    - `task.assigned`: "I become owner of a task"
    - `task.blocked`: "A task on my system is blocked"
    - `system.blocked`: "My system is blocked"
    - `system.done`: "My system is done"
    - `adr.proposed`: "A decision is proposed on my system"
    - `update.posted`: "A progress update on my system"
  - Columns "Inbox" and "Push", with a shadcn `Switch` per cell (add with `npx shadcn@latest add switch` if missing). The Push column is disabled with a tooltip when push is not set up.
  - A quiet hours card with an enable switch, start and end `<input type="time">`, and a time zone `NativeSelect` built from `Intl.supportedValuesOf("timeZone")`, defaulting to the browser's zone on first save.
  - A "Don't push while I'm using the app" switch.
  - One Save button with a "Saved" toast.
  - The devices section is left for Task 10; put an empty `<section id="devices">` placeholder component there and have Task 10 fill it.
- [ ] **Step 4: Run** `npm run lint && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(notifications): add personal notification settings and activity heartbeat`.

### Task 7: Encryption helper and project Discord webhooks

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/crypto.test.ts`
- Modify: `src/db/schema/notifications.ts` (add `project_webhook`, `discord_outbox`) and generate `npm run db:generate -- --name discord-webhooks`
- Create: `src/lib/ops/webhooks.ts`, `src/lib/ops/webhooks.test.ts`, `src/server/trpc/routers/webhooks.ts` (register as `webhooks`)
- Create: `src/app/(app)/p/[project]/settings/notifications/page.tsx` and `webhooks-view.tsx`
- Modify: `src/components/settings/settings-nav.tsx` (add "Notifications", owner only), `src/instrumentation.ts`, the worker start check, `.env.example`, `docker-compose.yml`, `docker-compose.coolify.yml`, `README.md`

**Interfaces:**
- `encryptSecret(plain: string): string` returns `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>` with AES-256-GCM, a random 12-byte iv and the key from `ENCRYPTION_KEY`. It throws when the key is missing or not 32 bytes after base64 decoding. `decryptSecret(value: string): string` throws `Error("Cannot decrypt secret")` on tampering or a wrong key.
- `DISCORD_EVENTS = ["system.done", "system.blocked", "system.moved", "planning.completed", "adr.proposed", "adr.accepted", "question.asked", "question.answered", "update.posted", "task.changed"] as const`, with the default set being everything except `system.moved` and `task.changed`.
- Table `project_webhook`:
  - `id` text pk
  - `projectId` FK cascade
  - `name` text not null (e.g. "#roadmap-surf")
  - `urlEnc` text not null
  - `urlHint` text not null: the last 4 characters of the token, shown as `…/••••abcd`
  - `events` text[] not null
  - `boardIds` text[] not null default `{}` (empty means all boards)
  - `digest` boolean not null default false
  - `timeZone` text not null default `"UTC"`
  - `enabled` boolean not null default true
  - `disabledReason` text null
  - `lastSentAt` timestamptz null
  - `lastDigestAt` timestamptz null
  - `createdAt`
  - `createdBy` FK user set null
- Table `discord_outbox`:
  - `id` bigserial pk
  - `webhookId` FK cascade
  - `changeLogId` bigint not null
  - `payload` jsonb not null (`DiscordItem`, Task 8)
  - `createdAt`
  - `sentAt` timestamptz null
  - Unique `discord_outbox_unique` on (`webhookId`, `changeLogId`), and an index on (`webhookId`, `sentAt`).
- Ops (owner only, `projectAccess(…, "owner")`):
  - `listWebhooks(db, actor, slug)`, which never returns the URL, only `urlHint`
  - `createWebhook(db, actor, slug, input)`
  - `updateWebhook(db, actor, slug, id, patch)`, which may replace the URL
  - `deleteWebhook(db, actor, slug, id)`
  - `sendTestMessage(db, actor, slug, id, queue: JobQueue)`, which enqueues `discord.test` on `QUEUE.deliver` with `jobId: "discord-test:" + id + ":" + minute`, so double clicks collapse
- `webhookInput`:
  - `name` 1–64 characters
  - `url` must match `^https://(discord\.com|discordapp\.com|canary\.discord\.com|ptb\.discord\.com)/api/webhooks/\d+/[\w-]+$` (the message: "Use a Discord webhook URL from Channel settings → Integrations → Webhooks.")
  - `events`: a non-empty subset of `DISCORD_EVENTS`
  - `boardIds`: board ids of the project; unknown ids are `InvalidError`
  - `digest`
  - `timeZone`, valid as in Task 3
- Setting `enabled: true` clears `disabledReason`. Every change is logged with entity `webhook` and never logs the URL.

- [ ] **Step 1: Write failing crypto tests:**
  - round trip
  - two encryptions of the same text differ
  - flipping one character of the ciphertext throws `Cannot decrypt secret`
  - a missing `ENCRYPTION_KEY` throws a message that names the variable

  Set `process.env.ENCRYPTION_KEY` in the test with `vi.stubEnv`.
- [ ] **Step 2: Implement** `src/lib/crypto.ts` with `node:crypto`. Run the tests. Expected: PASS.
- [ ] **Step 3: Write the tables** and generate the migration.
- [ ] **Step 4: Write failing op tests:**
  - an editor calling `createWebhook` gets `ForbiddenError`
  - a `https://example.com/hook` URL gets `InvalidError` with the message above
  - a board id from another project gets `InvalidError`
  - after creating, `listWebhooks` shows `urlHint` and no field containing `discord.com`
  - the `change_log` entry for `created` has no URL in `newValue`
  - `sendTestMessage` twice in the same minute leaves one job in `memoryQueue().jobs` (dedupe by `jobId`: `memoryQueue` must honour `jobId`; if Part 1's does not, extend it)
- [ ] **Step 5: Implement the ops and router**, then run the tests. Expected: PASS.
- [ ] **Step 6: Build the project settings page** "Notifications", owner only, following the Part 3 artifact mockup:
  - a list of webhooks, each with its name, hint, "Last sent 14 min ago", a red `disabledReason` line when disabled, an enable switch, "Send test message", Edit and Delete (with an `AlertDialog`)
  - an "Add Discord webhook" dialog with name, URL, event checkboxes (labels: "System done", "System blocked", "System moved to any column", "Planning completed", "Decision proposed", "Decision accepted", "Question asked", "Question answered", "Progress update", "Every task change"), board checkboxes (none selected means "All boards"), a "Weekly digest on Mondays at 09:00" switch, and the time zone select
  - a help line under the URL field: "Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL."
- [ ] **Step 7: Add `ENCRYPTION_KEY`** everywhere listed in Global Constraints.
- [ ] **Step 8: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(discord): add encrypted project webhooks with owner settings`.

### Task 8: Discord delivery with batching, 429 handling and the weekly digest

**Files:**
- Create: `src/lib/discord-format.ts`, `src/lib/discord-format.test.ts`
- Create: `src/worker/consumers/discord.ts`, `src/worker/jobs/discord.ts`, `src/worker/jobs/discord.test.ts`
- Modify: the worker registration list

**Interfaces:**
- `DiscordItem`: `{ event: DiscordEvent; projectName: string; projectSlug: string; title: string; detail: string; href: string; actorName: string | null; at: string }`, where `href` is an absolute URL built from `siteUrl()`.
- The consumer `discord`, `handleDiscordEvents(events, deps)`:
  - Maps each event to a `DiscordEvent`:
    - `system/column`: `system.done` or `system.blocked` by the current column category (with the Task 4 name check), plus `system.moved` for any column
    - `planning/completed`: `planning.completed`
    - `adr/created`: `adr.proposed`
    - `adr/status` with newValue `accepted`: `adr.accepted`
    - `question/created`: `question.asked`
    - `question/answer`: `question.answered`
    - `update/posted`: `update.posted`
    - any `task/*`: `task.changed`
  - For each enabled webhook of the project that subscribes to that event and whose `boardIds` is empty or contains the system's board, inserts a `discord_outbox` row with `onConflictDoNothing`.
  - For each webhook that got at least one new row, enqueues `discord.flush` on `QUEUE.deliver` with `jobId: "discord-flush:" + webhookId + ":" + Math.floor(now / 10000)` and `delayMs: 10000`.
- The job `discord.flush` `{ webhookId }`:
  - In a transaction it locks the webhook row (`for update`), returns when it is disabled, and selects unsent outbox rows oldest first, up to 50.
  - It builds messages with `buildDiscordMessages(items)`: up to 10 embeds per message, one embed per item. When more than 10 items share one system, they collapse into one embed "12 changes on search-index" listing the first 5.
  - It POSTs each message to `decryptSecret(urlEnc) + "?wait=true"` with `fetch` and a 10 s timeout (`AbortSignal.timeout(10000)`).
  - On 2xx it marks those rows `sentAt = now` and sets `lastSentAt`.
  - On 429 it reads `retry_after` (seconds, JSON body or header), leaves the rows unsent, enqueues another `discord.flush` with `delayMs = ceil(retry_after * 1000) + 250` and `jobId` suffixed `:retry:<n>`, and returns normally.
  - On 401 or 404 it sets `enabled = false` and `disabledReason = "Discord no longer accepts this webhook (404). Create a new webhook and paste its URL."`, and logs it.
  - On a 5xx or network error it throws, so BullMQ retries. Register the job with `attempts: 5` and exponential `backoff: { type: "exponential", delay: 5000 }`.
  - More than 50 pending rows enqueue a follow-up flush.
- The job `discord.test` `{ webhookId }` sends one embed, "Test message from Roadmap for <project>. Notifications will appear here.", with the same 401/404 handling.
- `digest.weekly` runs on `QUEUE.maintenance`, repeating every hour (cron `5 * * * *`, UTC). For each webhook with `digest = true` whose local time in `timeZone` is Monday 09:00–09:59, and whose `lastDigestAt` is null or more than 6 days ago:
  - It builds `buildDigest(data)` from the last 7 days of the project's change log:
    - shipped: `system/column` into a done category
    - started: into an active category
    - blocked now: systems currently in a blocked column
    - open questions: the count, with blocking ones listed first
    - decisions accepted
  - It sends one message and sets `lastDigestAt` in the same transaction as the send marker.
  - It is skipped when every section is empty.
- Embed format:
  - colour by event: done `0x1a7048`, blocked `0xc23636`, planning `0x6a4bd0`, adr `0x8a5a00`, default `0x0e7c86`
  - `title` is at most 256 characters, `description` at most 1024, `url` is `href`, and the footer is `<projectName> · <actorName>`
  - `allowed_mentions: { parse: [] }`, so text never pings a Discord user
  - `mentionsToPlain` applied to every text

- [ ] **Step 1: Write failing format tests:**
  - 3 items give 1 message with 3 embeds
  - 23 items across 23 systems give 3 messages (10, 10, 3)
  - 12 items on one system collapse into one embed whose description lists 5 items and ends with "and 7 more"
  - a title of 300 characters is cut to 256
  - `allowed_mentions.parse` is empty
  - a digest with empty sections returns `null`
- [ ] **Step 2: Implement** `discord-format.ts` and run it. Expected: PASS.
- [ ] **Step 3: Write failing worker tests** with `vi.stubGlobal("fetch", …)`:
  1. The consumer, for a `system/column` into Done with a webhook subscribed to `system.done`, inserts one outbox row and one flush job. Running it again adds no row (Review Focus 3).
  2. A webhook whose `boardIds` excludes the system's board gets no row.
  3. `discord.flush` with fetch returning 204 marks the rows sent and calls fetch once, with the URL ending `?wait=true`.
  4. With fetch returning 429 and `{ "retry_after": 1.5 }`, the rows stay unsent and a flush job with `delayMs` 1750 is queued (Review Focus 4).
  5. With fetch returning 404, the webhook is disabled with the reason, and a second flush makes no fetch call (Review Focus 4).
  6. With fetch returning 500, the job throws.
  7. The digest, with `now` on Monday 2026-10-05T07:10Z and `timeZone` `Europe/Berlin` (09:10 local), sends. Running it again that hour does not send. At 08:10 local it does not send.
- [ ] **Step 4: Implement** the consumer and jobs, and register them. Run the tests. Expected: PASS.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(discord): deliver batched project notifications and a weekly digest`.

### Task 9: Push subscriptions and the dispatcher

**Files:**
- Modify: `src/db/schema/notifications.ts` (add `push_subscription`) and generate `npm run db:generate -- --name push-subscriptions`
- Create: `src/lib/ops/push.ts`, `src/lib/ops/push.test.ts`, `src/lib/push-config.ts`
- Create: `src/worker/jobs/dispatch.ts`, `src/worker/jobs/dispatch.test.ts`
- Modify: `src/server/trpc/routers/notifications.ts` (devices)

**Interfaces:**
- Table `push_subscription`:
  - `id` text pk
  - `userId` FK cascade
  - `endpoint` text not null unique
  - `p256dh` text not null
  - `auth` text not null
  - `label` text not null (e.g. "Chrome on Windows", derived from the user agent on the client)
  - `createdAt`
  - `lastSuccessAt` timestamptz null
  - `failures` integer not null default 0
- `pushConfig(): { publicKey: string; privateKey: string; subject: string } | null`, read from the env. It returns `null` unless all three are set.
- Ops:
  - `subscribePush(db, actor, input: { endpoint: string (https URL, ≤ 1000 chars); keys: { p256dh: string; auth: string }; label: string (≤ 64) })`: an upsert on `endpoint` that reassigns the row to the actor, since the same browser may sign in as someone else
  - `unsubscribePush(db, actor, id)`, own rows only
  - `listDevices(db, actor)`, which returns `{ id, label, createdAt, lastSuccessAt }`
- tRPC:
  - `notifications.pushKey()` → `string | null` (the public key)
  - `notifications.subscribe(input)`, `notifications.unsubscribe({ id })`, `notifications.devices()`
  - `notifications.testPush({ id })` enqueues `push.test` with `jobId: "push-test:" + id + ":" + minute`
- The job `notifications.dispatch` runs on `QUEUE.deliver`, repeating every 5 s:
  - In a transaction it selects up to 200 `notification` rows with `pushStatus = 'pending'` and `createdAt` within the last 24 h, `for update skip locked`.
  - For each row:
    - When `pushConfig()` is null, the row becomes `skipped`.
    - When `canReceive` is now false, the row becomes `skipped` (Review Focus 1).
    - Otherwise it reads the rules and `isActive = (await kv.get(activeKey(userId))) !== null`, then applies `pushDecision`:
      - `skip`: set `skipped`
      - `later`: leave `pending` (it is picked up after quiet hours; the 24 h window bounds it)
      - `send`: for each of the user's subscriptions, enqueue `push.send` `{ notificationId, subscriptionId }` with `jobId: "push:" + notificationId + ":" + subscriptionId`, and set `sent`. With no subscriptions, set `skipped`.
  - Rows older than 24 h that are still `pending` become `skipped`.

- [ ] **Step 1: Write failing op tests:**
  - subscribing twice with the same endpoint leaves one row
  - a second user subscribing with that endpoint takes the row over
  - `unsubscribePush` of another user's id leaves it
  - an `endpoint` of `http://…` is `InvalidError`
- [ ] **Step 2: Implement the table and ops**, then run. Expected: PASS.
- [ ] **Step 3: Write failing dispatch tests** (`memoryQueue`, `memoryKv`, `vi.stubEnv` for the VAPID trio):
  1. A pending `mention` with one subscription gives one `push.send` job; the row is `sent`.
  2. Running it again enqueues nothing new.
  3. Without the VAPID env, the row is `skipped`.
  4. With the user's `active:` key set and default rules, the row is `skipped`.
  5. With quiet hours covering `now`, the row stays `pending` and no job is queued.
  6. With the member removed after the row was created, the row is `skipped` and no job is queued (Review Focus 1).
  7. A row created 25 h ago is `skipped`.
  8. `update.posted` with default rules was already `skipped` by `notify` (assert this from Task 2's behaviour).
- [ ] **Step 4: Implement** `dispatch.ts` and register it as a repeatable job every 5000 ms. Run it. Expected: PASS.
- [ ] **Step 5: Commit** `feat(push): add push subscriptions and the notification dispatcher`.

### Task 10: Sending Web Push, the service worker and device setup

**Files:**
- Create: `src/worker/jobs/push.ts`, `src/worker/jobs/push.test.ts`
- Create: `public/sw.js`
- Create: `src/components/notifications/push-devices.tsx`, `src/components/notifications/enable-push.tsx`, `src/lib/push-client.ts`
- Modify: `src/proxy.ts` (matcher), `next.config.ts` (headers for `/sw.js`), the Task 6 settings page (fill `#devices`), `package.json` (add `web-push` and `@types/web-push`), `README.md`, `.env.example`, the compose files (pass the VAPID trio to both `app` and `worker`)

**Interfaces:**
- `push.send` `{ notificationId, subscriptionId }`:
  - Loads both rows. When either is gone, it returns.
  - It re-checks `canReceive` and skips when that fails.
  - It builds the payload `{ title, body, href, tag: kind + ":" + entityId, id }` as JSON. When the encoded length exceeds 3000 bytes, it shortens `body`, then `title`, until it fits (Review Focus 5).
  - It calls `webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: kind === "mention" || kind.endsWith("blocked") ? "high" : "normal", topic: tag slug ≤ 32 chars [A-Za-z0-9_-] }, vapidDetails)`.
  - On 201 or 2xx it sets `lastSuccessAt` and `failures = 0`.
  - On 404 or 410 it deletes the subscription (Review Focus 5).
  - On 413 it retries once with `body` set to `""`.
  - On 429 or 5xx it increments `failures` and throws, so BullMQ retries with `attempts: 3` and exponential 10 s backoff. At `failures >= 10`, it deletes the subscription.
  - Import `web-push` only in this worker module, never in web code.
- `push.test` `{ subscriptionId }` sends "Test notification", "Push works on this device.", `href: "/settings/notifications"`.
- `public/sw.js` is plain JavaScript with no build step:
  - `push` event: parses JSON and calls `self.registration.showNotification(title, { body, tag, data: { href, id }, icon: "/icon-192.png", badge: "/icon-192.png" })`.
  - `notificationclick`: closes the notification, focuses an existing client with the same origin and calls `client.navigate(href)`, or opens `clients.openWindow(href)`.
  - `pushsubscriptionchange`: re-subscribes with the old options, then POSTs `{ oldEndpoint, subscription, label }` as JSON to `/api/push/resubscribe` (plain `fetch` with `credentials: "same-origin"`; the service worker cannot use the tRPC client). That route, `src/app/api/push/resubscribe/route.ts`, is session-authenticated and implemented in this task. It calls `subscribePush` and deletes `oldEndpoint` only when that endpoint belongs to the same user.
- `src/proxy.ts` matcher: add `sw.js` to the excluded list, so the service worker script is never redirected to `/login`.
- `next.config.ts`: `headers()` for `/sw.js` with `Cache-Control: no-cache, no-store, must-revalidate` and `Content-Type: application/javascript; charset=utf-8`.
- `push-client.ts`, browser only:
  - `pushSupport(): "supported" | "ios-needs-home-screen" | "unsupported" | "denied"`. On iOS or iPadOS, when not in standalone mode (`navigator.standalone !== true && !matchMedia("(display-mode: standalone)").matches`), it returns `ios-needs-home-screen`.
  - `enablePush(publicKey)`: registers `/sw.js` with scope `/`, and only then calls `Notification.requestPermission()`, **inside the click handler**. It subscribes with `userVisibleOnly: true` and `applicationServerKey` (a base64url → `Uint8Array` helper), then returns the subscription JSON and a label from `navigator.userAgent` ("Chrome on Windows", "Safari on iPhone", "Firefox on Android", and so on, falling back to "This browser").
  - `currentEndpoint()`, which marks "This device" in the device list.

- [ ] **Step 1: Write failing job tests**, mocking `web-push` with `vi.mock("web-push")`:
  - 201: `lastSuccessAt` is set
  - 410: the subscription row is deleted and the job does not throw
  - 413: `sendNotification` is called a second time with an empty body
  - 500: `failures` is 1 and the job throws
  - a 10 kB body produces a payload of at most 3000 bytes
  - a removed member's notification makes no call
- [ ] **Step 2: Implement** `push.ts` and register it. Run it. Expected: PASS.
- [ ] **Step 3: Write** `public/sw.js`, the resubscribe route and its test: a session actor posting an `oldEndpoint` owned by someone else leaves that row. Change the proxy matcher and the headers.
- [ ] **Step 4: Build the devices section** (`#devices`) of the settings page:
  - Rows show the label, "This device" on the current one, "Last push 2 h ago" or "Never", and the buttons "Send test" and "Remove".
  - Above the list, show one state:
    - supported, not subscribed: an "Enable on this device" button
    - `denied`: "Notifications are blocked for this site. Allow them in your browser's site settings, then reload."
    - `ios-needs-home-screen`: "On iPhone and iPad, push works from the home-screen app: tap Share → Add to Home Screen, open Roadmap from there, and enable it again."
    - `unsupported`: "This browser can't receive push notifications."
    - no server config: the Global Constraints sentence
  - Never call `requestPermission` outside the button's click handler.
- [ ] **Step 5: Add the VAPID variables** to `.env.example` (commented, with `npx web-push generate-vapid-keys`), to both compose files for `app` and `worker`, and to the README table as optional.
- [ ] **Step 6: Run** `npm run lint && npm run typecheck && npm test && npm run build`. Expected: PASS.
- [ ] **Step 7: Check it in the browser** with `npm run dev`, the dev worker from Part 1 running, and a VAPID pair in `.env`:
  1. Enable push in Chrome.
  2. Send a test and see the system notification. Click it and land on `/settings/notifications`.
  3. Remove the device and confirm the row is gone.
  4. Mention yourself from an agent key (`agent` set, a `question.asked` on your own system) and confirm a push arrives.
- [ ] **Step 8: Commit** `feat(push): send web push to browsers and phones with a service worker`.

---

## Self-review notes for the executor

- Every name in "Interfaces" is used exactly as written by later tasks: `notify`, `canReceive`, `NOTIFICATION_KINDS`, `readNotifyRules`, `pushDecision`, `activeKey`, `encryptSecret`, `decryptSecret`, `DISCORD_EVENTS`, `DiscordItem`, `pushConfig`, the job names `notifications.dispatch`, `push.send`, `push.test`, `discord.flush`, `discord.test`, `digest.weekly`, and the consumer names `notifications` and `discord`.
- Part 9 replaces the 60 s `unread` polling with a live invalidation of the tRPC path `notifications` on the channel `user:<userId>`. Keep the query keys under `notifications.*` so that works.
- Part 7 adds GitHub-related kinds (for example `pr.merged`) by appending to `NOTIFICATION_KINDS` and `DEFAULT_NOTIFY_RULES`. Keep both as single exported constants.
