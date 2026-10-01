# Part 6 (notifications): report

Branch `feat/v2`, commits `9465003..4e96b37`: 10 task commits plus 1 final-review fix commit. Gate green at `4e96b37`: lint, typecheck, 926 tests, 38 plugin tests, 14 Valkey integration tests, build and build:worker. Migrations 0024–0026. New dependency: `web-push` 3 (worker only).

## Tasks done
All 10 tasks are done and each passed review:
1. Mention tokens and member name resolution
2. Notification rows, recipient checks (`canReceive`), inbox ops, mentions in content ops (also through the batch tools)
3. Personal notification rules and quiet hours
4. Change-feed consumer that turns change-log entries into notifications
5. Bell, inbox page `/notifications`, mention picker and mention chips
6. Personal notification settings page and the activity heartbeat
7. AES-256-GCM secret helper and encrypted project Discord webhooks (owner settings page)
8. Discord delivery with batching, 429 handling and the weekly digest
9. Push subscriptions and the dispatcher
10. Web Push sending, the service worker and device setup

Tasks 3/4, 6/7 and 8/9 ran in parallel (separate files). Their fix commits were folded back in, so each task is still one commit.

These needed fix rounds:
- **Task 3:** a client settings file pulled the database schema into the browser bundle. The rules schema now lives in a client-safe module.
- **Task 5:** the "99+" badge could never show. The unread count now caps at 100 (ruling).
- **Task 6:** the heartbeat toasted on every failure and refetched the bell and account queries every minute. It now uses the plain tRPC client.
- **Task 8:** two fix rounds.
  - Round 1: Discord POSTs no longer run while the webhook row is locked; that lock would have stalled the change feed. Messages also stay under Discord's 6000-character limit.
  - Round 2: a job-id collision on busy re-queues could lose a flush.
- **Task 9:**
  - A browser endpoint taken over by another user kept its id, so pushes already queued could reach the wrong person. It now gets a new id.
  - Quiet-hour rows could starve the 200-row batch. They now page past it.
- **Task 10:**
  - A VAPID config error would have deleted every subscription. Only real push-service or network failures count now.
  - Permission is asked first inside the click (ruling).
  - Also fixed:
    - the device marker is sent as a hash, not the endpoint
    - notification clicks stay on the same origin
    - the resubscribe route has a CSRF guard
    - the payload cap is absolute

The Opus final review found two important problems, fixed in 4e96b37:
- A question, answer or update that mentioned someone who was also notified by the feed produced two notifications (two pushes). The mention now wins (ruling).
- The README deploy and upgrade steps didn't mention `ENCRYPTION_KEY`, which is now required.

The same commit fixed these smaller items:
- **Retention:** sent Discord outbox rows are kept 7 days; notifications are deleted 90 days after being read or 180 days after creation.
- **Notifications:**
  - `notify` stores nothing when both inbox and push are off.
  - Emoji are no longer split when titles are cut.
  - Long text keeps its plain `@Name` when resolving it would pass the field limit.
  - A My work mention click marks it read.
  - `setRules` accepts older clients.
  - Question notices follow a moved question.
- **Discord:** archived projects don't post, and an auto-disabled webhook drops its stale backlog.
- **Push and startup:**
  - The `ENCRYPTION_KEY` shape is checked at start (app and worker).
  - TLS errors count toward pruning dead push endpoints.
  - The resubscribe guard trusts `Sec-Fetch-Site: same-origin`.
- **Mentions:** `~~~` and unclosed code fences are protected from mention resolution.
- **Part 7 prep:** the extension points for new kinds are documented on `NOTIFICATION_KINDS`.

## Deviations from the plan
- **Job ids** use `-` instead of `:`, because BullMQ rejects `:`.
- **`JobOptions`** gained optional `attempts` / `backoffMs`, for `push.send`'s 3 × 10 s retries.
- **`ENCRYPTION_KEY`** is in `APP_REQUIRED_ENV` / `WORKER_REQUIRED_ENV`, the repo's equivalent of the plan's `REQUIRED` list and worker start check. Its shape is also checked at start.
- **Unread count** caps at 100 instead of 99, and plan test 8 expects 100.
- **Discord flush and digest** use a 60 s Valkey lock per webhook. The HTTP runs outside database transactions, with at-least-once delivery, instead of the plan's `FOR UPDATE` on the webhook row.
- **Discord edge cases:**
  - Other 4xx answers are logged and dropped, so one bad payload can't block the outbox.
  - 429 and busy retries are capped at 10.
  - `disabledReason` keeps "(404)" for 401 too.
- **Push permission order:** `enablePush` asks for permission first, synchronously in the click, and registers the service worker in parallel. The service worker is also registered when the devices section mounts.
- **Device list:** `notifications.devices` takes an `endpointHash` (SHA-256) to mark "This device".
- **Mention vs feed:** one action that both mentions and feed-notifies a person keeps only the mention.
- **Retention** for `discord_outbox` and `notification` was added. The index sets none.
- **Smaller additions:**
  - `notifications.list` takes `cursor` and `unread`.
  - `INVALIDATES.notifications` also covers `account`, because My work lists mentions.
  - `useTRPCClient` is exported.
  - `addWithTimeout` is shared by the web enqueue points.

## Decisions I made (rulings)
1. Ruling: job ids use `-` instead of `:` (`discord-test-<id>-<minute>`, `discord-flush-<webhookId>-<bucket>[-retry-<n>]`, `push-<notificationId>-<subscriptionId>`, `push-test-<id>-<minute>`) — BullMQ throws "Custom Id cannot contain :" and the index forbids `:` — cost if wrong: cosmetic id format.
2. Ruling: crons pass `tz: "UTC"` — plan says UTC; Part 5 added Schedule.tz — cost if wrong: none.
3. Ruling: ENCRYPTION_KEY goes into APP_REQUIRED_ENV and WORKER_REQUIRED_ENV — the repo's "REQUIRED" list and worker start check — cost if wrong: none.
4. Ruling: mentions are wired in the shared `…InTx` / apply functions so the batch tools are covered too — a batch path that skips mentions would be a silent gap — cost if wrong: slightly wider diff.
5. Ruling: `JobOptions` gains optional `attempts` and `backoffMs` — the plan needs per-job retries the queue API lacked — cost if wrong: small API extension.
6. Ruling: unreadCount caps at 100 so the bell can show "99+"; plan test 8 becomes 100 — the plan contradicts itself — cost if wrong: one test value.
7. Ruling: Discord flush and digest serialise per webhook with a 60 s Kv lock and do HTTP outside DB transactions — the plan's row lock would stall the change feed while Discord is slow — cost if wrong: a rare duplicate Discord message after a crash.
8. Ruling: enablePush requests permission synchronously first in the click and registers /sw.js in parallel — the plan's order loses user activation on iOS/Firefox — cost if wrong: none functional.
9. Ruling: when one action both mentions a person and feed-notifies them, the mention survives — one push per action — cost if wrong: the kind shows "mention" instead of e.g. "question.asked".
10. Ruling: retention prunes Discord outbox rows sent over 7 days ago and notifications read over 90 days ago or created over 180 days ago — bounded delivery state — cost if wrong: older inbox history disappears.

## Parked minor findings
- **Mentions:**
  - Removing a mention and adding it back doesn't notify again (stable source key, by design).
  - One write that mentions someone and also triggers a different feed kind for the same entity keeps only the mention.
  - The mention picker has a combobox role on a textarea.
- **Discord:**
  - The Discord Kv lock has no owner token. A flush slower than 60 s could release another worker's lock.
  - An archived project's pending Discord rows replay if it is un-archived.
  - Webhook settings parse input before the owner check (editor with a bad URL gets 400, not 403).
  - Renaming a webhook or replacing its URL isn't written to the change log, per the plan's field list.
- **Push:**
  - A push may be sent twice if the dispatcher's commit fails after it queued the job.
  - Pushes during a VAPID misconfiguration are dropped (logged once).
- **Tests:** the Task 4 query-count test only covers the loader.

## Things you should know
- **`ENCRYPTION_KEY` is now required.** Your local `.env` needs it, or `npm run dev` and the worker won't start. Generate it with `openssl rand -base64 32`. I did not touch `.env`. Keep the key: a new one makes saved Discord webhook URLs unreadable.
- **Valkey container:** the throwaway Valkey container (`v2-check-valkey`) disappeared during the run, probably after a Docker restart. I started a new one on the same port for the integration tests.
- **Trailers:** every Part 6 commit carries the Opus trailer.

## Manual checks still to do (need sign-in, a VAPID pair or a real Discord webhook)
- **Task 5:** mention picker in each replaced textarea (arrows, Enter/Tab, Escape, focus), the bell badge, the inbox page, and mention chips in markdown.
- **Task 6:** `/settings/notifications`:
  - rules table and Save toast
  - quiet hours with the time zone select
  - Push switches disabled with a tooltip when VAPID is unset
- **Task 7:** project Settings → Notifications: add, edit and delete a Discord webhook, Send test message.
- **Task 8:** a real Discord channel: batched messages, a 429 retry, a deleted webhook getting disabled, and the Monday digest.
- **Task 10:** with a VAPID pair, the dev worker running and `.env` filled:
  - enable push in Chrome
  - test push, click through to `/settings/notifications`
  - remove the device
  - an agent `question.asked` on your own system pushes
  - Safari/iOS from the home-screen app
  - `curl -I /sw.js` headers
