# roadmap-app v2 Part 9: Live Updates, Presence and German Interface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open boards and system pages update themselves when anyone (person or agent) changes something, system pages and board cards show who else is there, and every screen can be used in German.

**Architecture:** A change-feed consumer in the worker turns each batch of `change_log` rows into a list of tRPC router names to refresh and publishes it on the bus channel `project:<projectId>`. The web process holds one bus subscription per channel, shared by every browser tab through an in-process hub, and streams messages over server-sent events at `/api/events/[project]`. The client invalidates only the named routers. Presence is a short-lived Kv hash per system, refreshed by a heartbeat from open system pages; agents count as present when they called a tool on that system in the last 2 minutes. The German interface uses next-intl without locale routing: the locale comes from the user's `locale` preference, then `Accept-Language`, then English.

**Tech Stack:** Next.js 16 route handlers (Node runtime, `ReadableStream`), browser `EventSource`, the Part 1 bus, Kv and feed APIs, next-intl 4 (`npm view next-intl version`; pin with `^`), vitest with fake timers.

**Spec:** no v2 spec (plans only; see the v2 index). This part lifts the 2026-09-29 spec's out-of-scope line "Real-time updates (websockets). Pages render fresh on navigation." (Task 9.3 edits it).

## Global Constraints

Everything in `2026-10-01-roadmap-v2-index.md` → Global Constraints applies. In addition:

- The realtime message on `project:<projectId>` is exactly `{ keys: string[] }`. Each key is the name of a top-level router in `appRouter` (`src/server/trpc/router.ts`), or the literal `"presence"`. Messages never carry entity content, names or values. A client learns only that something changed, and then refetches through normal access checks.
- The SSE endpoint is read-only and needs a session. API keys are not accepted there: agents don't need live updates.
- Heartbeats and presence reads never go through the tRPC mutation cache, because a heartbeat must not trigger the global or scoped query invalidation from Part 0.
- Agent-facing text stays English: tool names, tool descriptions, op error messages (`src/lib/ops/*` `throw new …Error("…")`), MCP and REST responses, and Discord channel messages (project-wide, not per person). Op error messages shown in toasts therefore stay English in the German UI, which is accepted.
- German copy uses the informal *du* form throughout, as developer tools commonly do. Use the terminology table in Task 9.9 for every translated term.
- Every user-facing string in `src/app/**` and `src/components/**` (except `src/components/ui/**`) goes through next-intl: JSX text, `placeholder`, `aria-label`, `title`, `alt`, `sr-only` text, toast text, dialog titles, page `metadata` titles. Plurals use ICU plural syntax; never build a sentence by concatenating strings.
- Commits: `feat(realtime): …`, `feat(presence): …`, `feat(i18n): …`, `docs: …`, each ending with the `Co-Authored-By` line from the index.

## Names this part relies on

| Name | From | Used for |
| --- | --- | --- |
| `registerFeedConsumer(name, handle)`, `ChangeEvent`, `WorkerDeps` | Part 1, `src/worker/feed.ts`, `src/worker/deps.ts` | the realtime consumer |
| `EventBus`, `valkeyBus()`, `memoryBus()` | Part 1, `src/lib/bus.ts` | publish and subscribe |
| `Kv`, `valkeyKv()`, `memoryKv()` | Part 1, `src/lib/kv.ts` | presence hashes |
| `getPref(db, userId, key)`, `setPref(db, userId, key, value)` | Part 1, `src/lib/ops/prefs.ts` | keys `locale` and `timeZone` |
| `projectAccess(db, actor, slug, need)` | `src/lib/ops/access.ts` | visibility checks (404 when invisible) |
| `sessionActor()` | `src/lib/auth/actor.ts` | SSE and heartbeat auth |
| `agent_call` table (Part 5): columns for user, agent name, system, `createdAt` | Part 5 | agents in presence. Part 5 defines `agent_call` with `runId` (→ `agent_run.userId`), `agent`, `projectId`, `systemSlug` and `at`; match a system by `projectId` + `systemSlug` and the person through the join to `agent_run` |
| Part 0 query invalidation (scoped `pathFilter` use in `src/trpc/client.tsx`) and error, not-found and loading screens | Part 0 | the client hook reuses the same `pathFilter` style; the i18n tasks translate the Part 0 screens |
| Routers and entity names added by Parts 2–8 | Parts 2–8 | invalidation map (Task 9.1) and string extraction (Tasks 9.10–9.15) |

## Review Focus

1. **A member is removed while their board tab is open.** The stream is closed within one recheck interval (at most 5 minutes) with `event: gone`, and the client stops reconnecting. Messages never contain content, so nothing leaks meanwhile. Pinned in Task 9.3 (recheck test).
2. **A deploy restarts the web process and every open tab reconnects at once.** Reconnects spread out with exponential backoff plus jitter, and each tab refetches once after reconnecting instead of in a loop. Pinned in Task 9.4 (`backoffDelay` and catch-up tests).
3. **A change in project A reaches a client watching project B.** It never does: channels are per project id, and the hub delivers only to the channel's own listeners. Pinned in Task 9.1 (grouping test) and Task 9.2 (hub isolation test).
4. **A stored `locale` preference that is no longer supported (`"fr"`, `null`, a number) or a garbage `Accept-Language` header.** English is used and nothing throws. Pinned in Task 9.7 (`resolveLocale` tests).
5. **Times rendered on the server differ from the hydrated client** (time zone or locale mismatch, "vor 5 Min." versus "vor 6 Min."). Server and client format with the same `timeZone`, `locale` and render clock (`useNow`), so there's no hydration warning. Pinned in Task 9.7 (provider render test) and Task 9.13 (relative-time render test).

---

### Task 9.1: Invalidation map and realtime feed consumer

**Files:**
- Create: `src/lib/realtime/keys.ts`
- Create: `src/lib/realtime/keys.test.ts`
- Create: `src/worker/consumers/realtime.ts`
- Create: `src/worker/consumers/realtime.test.ts`
- Modify: the worker's consumer registration entry point (Part 1, where other consumers are imported, e.g. `src/worker/main.ts`)

**Interfaces:**
- Consumes: `ChangeEvent`, `WorkerDeps`, `registerFeedConsumer` (Part 1).
- Produces:
  - `INVALIDATION_KEYS: Record<string, readonly string[]>`, keyed by change-log `entity`
  - `FALLBACK_KEYS: readonly string[]`
  - `invalidationKeys(events: ChangeEvent[]): Map<string, string[]>`, mapping projectId to sorted unique router names
  - `realtimeChannel(projectId: string): string`, returning `` `project:${projectId}` ``
  - consumer name `"realtime"`

- [ ] **Step 1: Collect entity names and router names.** Run `grep -rhoE 'entity: "[a-z_-]+"' src/lib/ops | sort -u` and read `src/server/trpc/router.ts`. In v1 the entities are `adr, board, document, domain, member, phase, planning, project, question, system, task, update`. Parts 2–8 add more, and you must include every name the grep returns. Write the map with these rows, adding a row for each entity Parts 2–8 introduced, using the router that serves it:

  | entity | keys |
  | --- | --- |
  | `project` | `projects`, `history` |
  | `board`, `column` | `boards`, `projects`, `systems`, `history` |
  | `domain`, `phase` | `structure`, `systems`, `projects`, `history` |
  | `system` | `systems`, `boards`, `projects`, `planning`, `history` |
  | `task` | `systems`, `projects`, `history` |
  | `document` | `systems`, `history` |
  | `planning` | `planning`, `systems`, `projects`, `history` |
  | `adr` | `adrs`, `systems`, `projects`, `history` |
  | `question` | `questions`, `systems`, `projects`, `history` |
  | `update` | `systems`, `history` |
  | `member` | `members`, `projects` |
  | each entity added by Parts 2–8 | its own router (for example `releases`, `pages`, `glossary`, `gates`, `github`, `insight`), plus `systems` when it is shown on the system page, plus `history` |

  Every key must be a router name that exists in `appRouter`. `FALLBACK_KEYS` is `["projects", "systems", "boards", "history"]`, for an entity missing from the map.
- [ ] **Step 2: Write failing tests in `src/lib/realtime/keys.test.ts`.**
  - `invalidationKeys([task event in project p1])` returns a Map with `p1 → ["history","projects","systems"]` (sorted, unique).
  - Two events in `p1` (task, adr) and one in `p2` (member) give two entries. `p1` holds the union of their keys, sorted. `p2 → ["members","projects"]`.
  - An unknown entity `"zzz"` in `p1` gives `FALLBACK_KEYS` sorted.
  - An empty array gives an empty Map.
  - For every entity name, the test holds a hard-coded list copied from the Step 1 grep; `INVALIDATION_KEYS[name]` is defined.
  - For every key in every row, `key in appRouter._def.record` holds. Import `appRouter` from `@/server/trpc/router`, which works in tests because `server-only` is aliased.
- [ ] **Step 3: Run the test to see it fail.** Run `npx vitest run src/lib/realtime/keys.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement `keys.ts`.** It holds the map, `FALLBACK_KEYS`, `invalidationKeys` (group by `projectId`, union into a Set, sort) and `realtimeChannel`. It is a pure module with no imports from db or Valkey.
- [ ] **Step 5: Write failing tests in `src/worker/consumers/realtime.test.ts`.**
  - Call the exported handler `handleRealtime(events, deps)` with `deps.bus = memoryBus()`, and subscribe to `project:p1` and `project:p2` before calling.
  - Events in `p1` and `p2` give exactly one message per channel, each `{ keys: [...] }` equal to `invalidationKeys` output.
  - No events means no publish.
  - A message never contains fields other than `keys`: assert `Object.keys(message)` equals `["keys"]`.
- [ ] **Step 6: Implement the consumer.** Export `handleRealtime(events: ChangeEvent[], deps: WorkerDeps): Promise<void>`. It publishes one message per project via `deps.bus.publish(realtimeChannel(id), { keys })`, and at module load calls `registerFeedConsumer("realtime", handleRealtime)`. Import the module from the worker entry point next to the other consumers. A publish failure is logged and does not throw, so the feed cursor still advances: live updates are best effort, and the next change or the reconnect catch-up covers a miss.
- [ ] **Step 7: Run the tests.** Run `npx vitest run src/lib/realtime src/worker/consumers/realtime.test.ts`. Expected: PASS.
- [ ] **Step 8: Commit.** `feat(realtime): publish invalidation keys for each project from the change feed`

### Task 9.2: Per-process subscription hub

**Files:**
- Create: `src/server/realtime/hub.ts`
- Create: `src/server/realtime/hub.test.ts`

**Interfaces:**
- Consumes: `EventBus`, `valkeyBus()` (Part 1).
- Produces:
  - `createHub(bus: EventBus): Hub`, where `interface Hub { join(channel: string, listener: (message: object) => void): Promise<() => void>; size(channel: string): number }`
  - `getHub(): Hub`, a process-wide singleton on `globalThis.roadmapHub`, built from `valkeyBus()`, following the `globalForDb` pattern in `src/db/client.ts`

- [ ] **Step 1: Write failing tests with `memoryBus()` wrapped in a spy that counts `subscribe` calls and the unsubscribe calls it returns.**
  - Two `join("project:p1", …)` calls make exactly one `bus.subscribe`. A publish on `project:p1` reaches both listeners.
  - `join("project:p2")` gets nothing from a `project:p1` publish (isolation).
  - After the first leave, the second listener still receives messages and `size("project:p1")` is 1. After the last leave, the bus unsubscribe runs once and `size` is 0.
  - Calling a leave function twice is harmless: `size` never goes negative.
  - A listener that throws doesn't stop the other listeners.
  - Two concurrent `join` calls on a new channel, started together without awaiting in between, still make exactly one `bus.subscribe`. Keep a pending-subscription promise per channel.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/server/realtime/hub.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the hub.**
  - Keep a `Map<channel, { listeners: Set<fn>; ready: Promise<unsubscribe> }>`.
  - `join` adds the listener, creating the bus subscription on first use, and returns an idempotent leave function.
  - Listener calls are wrapped in try/catch.
  - Read Part 1's `valkeyBus()`. If its `subscribe` opens a new connection per call, `getHub` must still call `subscribe` only once per channel, and the hub already guarantees that. Don't change Part 1.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(realtime): share one bus subscription per channel across open streams`

### Task 9.3: SSE endpoint `/api/events/[project]`

**Files:**
- Create: `src/server/realtime/stream.ts`
- Create: `src/server/realtime/stream.test.ts`
- Create: `src/app/api/events/[project]/route.ts`
- Modify: `README.md` (new "Live updates" subsection under deployment)
- Modify: `docs/superpowers/specs/2026-09-29-roadmap-app-design.md` §2 (out of scope)

**Interfaces:**
- Consumes: `Hub` (Task 9.2), `realtimeChannel` (Task 9.1), `sessionActor`, `projectAccess`, `getDb`, `loadActor` (`src/lib/ops/users.ts`).
- Produces:
  - `createEventStream(opts: { hub: Hub; channel: string; signal: AbortSignal; heartbeatMs?: number; recheckEvery?: number; stillAllowed: () => Promise<boolean> }): ReadableStream<Uint8Array>`
  - `SSE_HEADERS: Record<string, string>`
  - the route `GET /api/events/[project]`

- [ ] **Step 1: Write failing tests for `createEventStream` with `vi.useFakeTimers()`, a hub from `createHub(memoryBus())` and an `AbortController`. Read chunks with `stream.getReader()` and decode them with `TextDecoder`.**
  - The first chunk is `retry: 5000\n\n` followed by `event: ready\ndata: {}\n\n`. They may arrive in one or two chunks, so assert on the concatenated text.
  - Publishing `{ keys: ["systems"] }` on the channel produces a chunk `data: {"keys":["systems"]}\n\n`.
  - Advancing 25 000 ms produces `: ping\n\n`.
  - With `recheckEvery: 2`, heartbeat 25 000 ms and `stillAllowed` resolving `false`, then after 50 000 ms the stream emits `event: gone\ndata: {}\n\n` and closes: the reader returns `done: true`. The hub's `size(channel)` is then 0.
  - Aborting the controller closes the stream, leaves the hub (`size` 0) and clears the heartbeat, so advancing timers produces no more chunks.
  - A publish on another channel produces nothing.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/server/realtime/stream.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `stream.ts`.**
  - Defaults: `heartbeatMs = 25_000`, `recheckEvery = 12` (about 5 minutes).
  - Each bus message is written as `data: ${JSON.stringify(message)}\n\n`.
  - On close, abort or gone: clear the interval, call leave, and close the controller once (guard against double close).
  - `SSE_HEADERS` = `{ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "X-Accel-Buffering": "no" }`. `no-transform` keeps Next's built-in compression from buffering the stream; `X-Accel-Buffering: no` does the same for nginx-style proxies.
- [ ] **Step 4: Implement the route.**
  - Set `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
  - `GET(request, { params })`: with no session, return `Response.json({ error: "Sign in to receive live updates." }, { status: 401 })`.
  - Call `projectAccess(getDb(), actor, slug, "viewer")`. On `NotFoundError`, return 404 JSON. Other errors are rethrown.
  - `stillAllowed` reloads the actor with `loadActor(getDb(), actor.userId)` and re-runs `projectAccess`. It resolves `false` when the actor is gone or access throws.
  - Return `new Response(createEventStream({ hub: getHub(), channel: realtimeChannel(project.id), signal: request.signal, stillAllowed }), { headers: SSE_HEADERS })`.
  - `src/proxy.ts` already excludes `api/`, so no change is needed there. Confirm by reading its matcher.
- [ ] **Step 5: Check it by hand.** Run `docker compose up -d postgres valkey`, `npm run dev`, and `npm run worker:dev` (the Part 1 worker dev script; use its real name from `package.json`). Sign in, open `/api/events/<slug>` in the browser and see `event: ready`. Change a task in another tab and see a `data:` line within about 2 seconds.
- [ ] **Step 6: Update the docs.**
  - In the 2026-09-29 spec §2, replace the bullet "Real-time updates (websockets). Pages render fresh on navigation." with "Real-time updates: lifted in v2. Pages receive change notices over server-sent events (`/api/events/[project]`) and refetch what changed; see `docs/superpowers/plans/2026-10-01-roadmap-v2-09-realtime-i18n.md`."
  - In `README.md`, add a subsection "Live updates" with these points:
    - The browser keeps one SSE connection per open project page.
    - Coolify's Traefik doesn't buffer streams, so nothing needs configuring there.
    - Behind nginx, set `proxy_buffering off` for `/api/events/`.
    - The worker must be running for live updates. Without it, pages still work and update on navigation.
- [ ] **Step 7: Run the tests.** Run `npx vitest run src/server/realtime`. Expected: PASS.
- [ ] **Step 8: Commit.** `feat(realtime): stream project change notices over server-sent events`

### Task 9.4: Client subscription with debounced invalidation

**Files:**
- Create: `src/trpc/realtime.ts` (pure helpers)
- Create: `src/trpc/realtime.test.ts`
- Create: `src/trpc/use-project-events.ts` (client hook, `"use client"`)
- Modify: `src/components/shell/shells.tsx` (`ProjectShell` calls the hook)

**Interfaces:**
- Consumes: `useTRPC()` and `useQueryClient()` (existing, `src/trpc/client.tsx`), the message shape `{ keys: string[] }`.
- Produces:
  - `backoffDelay(attempt: number, random?: () => number): number`
  - `createKeyBatcher(flush: (keys: string[]) => void, delayMs: number): { add(keys: string[]): void; cancel(): void }`
  - `useProjectEvents(projectSlug: string): void`

- [ ] **Step 1: Write failing tests in `src/trpc/realtime.test.ts`.**
  - `backoffDelay` with `random = () => 0.5`: attempt 0 is 1000, attempt 1 is 2000, attempt 3 is 8000, attempt 10 is capped at 60000. The formula is `min(60000, 1000 * 2 ** attempt)` times a jitter factor in `[0.75, 1.25)`. With `random = () => 0` attempt 0 is 750, and with `() => 0.999` it is under 1250.
  - `createKeyBatcher` with fake timers and `delayMs` 300: `add(["systems"])`, then after 100 ms `add(["history","systems"])`, then after 300 ms more, `flush` was called once with `["history","systems"]`. Nothing is flushed before 300 ms since the last `add`, but a steady stream of adds still flushes at least every 1000 ms (max wait). `cancel()` prevents a pending flush.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/trpc/realtime.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the helpers.** Leading-edge flushes are not needed: trailing flush with debounce 300 ms and max wait 1000 ms.
- [ ] **Step 4: Implement `useProjectEvents(slug)`.**
  - In an effect, open `new EventSource(`/api/events/${slug}`)`.
  - On `message`, parse the JSON in try/catch (ignore bad data), keep only keys that exist on the tRPC proxy (`key in trpc`, plus `"presence"` handled like any router name), and add them to the batcher.
  - `flush` calls `queryClient.invalidateQueries(trpc[key].pathFilter())` for each key.
  - On `ready`, if this is a reconnect (a previous connection had been open), invalidate every router once to catch up on missed changes. The first `ready` after mount does nothing, because the page is fresh.
  - On `gone`, close and don't reconnect.
  - On `error`, close, then reconnect after `backoffDelay(attempt++)`. Reset `attempt` on `ready`.
  - When `document.visibilityState` has been `hidden` for 60 s, close. On `visible`, reopen, and that `ready` counts as a reconnect.
  - Clean up everything on unmount or slug change.
  - Failures are silent: no toast, no `console.error`. Only a `console.debug` on reconnect scheduling is allowed.
- [ ] **Step 5: Mount the hook.** In `ProjectShell`, call `useProjectEvents(slug)`. Global pages (home, settings, admin) don't subscribe.
- [ ] **Step 6: Check it by hand.** Open the same board in two windows and move a card in one. The other updates within about 2 seconds without reload. Stop the dev server, and the page stays usable with no error overlay or toast. Start it again, and within about 60 s the page reconnects and refetches once (watch the Network tab).
- [ ] **Step 7: Run the tests, lint and typecheck.** Run `npx vitest run src/trpc/realtime.test.ts`, `npm run lint` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 8: Commit.** `feat(realtime): refresh open project pages when the project changes`

### Task 9.5: Presence heartbeat and queries

**Files:**
- Create: `src/lib/ops/presence.ts`
- Create: `src/lib/ops/presence.test.ts`
- Create: `src/app/api/presence/route.ts`
- Create: `src/server/trpc/routers/presence.ts`
- Modify: `src/server/trpc/router.ts` (register `presence`)

**Interfaces:**
- Consumes: `Kv` (Part 1), `EventBus`, `realtimeChannel` (Task 9.1), `projectAccess`, `findSystem` (existing in `src/lib/ops/systems.ts`, or the lookup helper Part 2 left there; read the file), and the Part 5 `agent_call` table.
- Produces:
  - `PRESENCE_TTL_SECONDS = 60`, `AGENT_PRESENCE_MS = 120_000`
  - `interface PresentPerson { userId: string; name: string; at: string }` (ISO)
  - `interface PresentAgent { userId: string; name: string; agent: string; at: string }`
  - `heartbeat(db, kv, actor, input: { project: string; system: string; leaving?: boolean }, now: Date): Promise<{ changed: boolean; projectId: string }>`
  - `systemPresence(db, kv, actor, input: { project: string; system: string }, now: Date): Promise<{ people: PresentPerson[]; agents: PresentAgent[] }>`
  - `boardPresence(db, kv, actor, input: { project: string; board: string }, now: Date): Promise<Record<string, { people: PresentPerson[]; agents: PresentAgent[] }>>`, keyed by system slug
  - `POST /api/presence`
  - tRPC `presence.system` and `presence.board` queries

- [ ] **Step 1: Write failing tests in `src/lib/ops/presence.test.ts`.** Use PGlite fixtures (`createProjectFixture`, `addMemberFixture`, `createSystem`), `memoryKv()` and an explicit `now`.
  - Viewer A's first `heartbeat` returns `changed: true`. A second one 30 s later returns `changed: false`.
  - B's `systemPresence` at now+30 s lists A with A's name. A's own `systemPresence` doesn't list A (the actor is excluded).
  - At now+61 s after A's last heartbeat, A isn't listed: filter on `at` age of 60 s or more, even when the hash still exists.
  - `heartbeat` with `leaving: true` returns `changed: true`, and A isn't listed afterwards.
  - An outsider (not a member) calling `heartbeat` or `systemPresence` gets `NotFoundError`.
  - Insert `agent_call` rows for user A on this system with agent "Claude Code", 90 s ago and 3 minutes ago. `agents` holds one entry (`agent: "Claude Code"`, `at` = the 90 s one). Several calls by the same user and agent collapse to the most recent.
  - `boardPresence` for a board with two systems, A present on one, returns an entry only for that system's slug.
- [ ] **Step 2: Run the tests to see them fail.** Run `npx vitest run src/lib/ops/presence.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the ops.** They don't take a transaction and don't log changes, because presence isn't content.
  - Key is `presence:<systemId>`, field `actor.userId`, value `JSON.stringify({ name: actor.name, at: now.toISOString() })`, written with `kv.hset(key, field, value, PRESENCE_TTL_SECONDS)`.
  - Leaving writes `at` as `new Date(0).toISOString()` (Kv has no field delete).
  - `changed` is true when the previous value was missing, stale (60 s or older) or a leave marker, or when this call is a leave.
  - The agent query selects from `agent_call` where the system matches and `createdAt > now - AGENT_PRESENCE_MS`. It joins `user` for the name, groups by user and agent, and takes the max `createdAt`.
  - `boardPresence` lists the board's systems (a cheap id and slug query), reads their hashes with one `hgetall` each, and runs one agent query with `systemId IN (…)`.
- [ ] **Step 4: Implement `POST /api/presence`.**
  - Body `{ project, system, leaving? }`, validated with zod (slugs via `slugSchema`); 400 on bad input.
  - Session through `sessionActor()`: 401 without one, 404 on `NotFoundError`.
  - Call `heartbeat(getDb(), valkeyKv(), actor, body, new Date())`. When `changed`, publish `{ keys: ["presence"] }` on `realtimeChannel(projectId)` via `valkeyBus()`.
  - Respond `204`. Accept `text/plain` bodies too, because `navigator.sendBeacon` sends a string, and parse them with `JSON.parse` in try/catch.
- [ ] **Step 5: Implement the tRPC router.** `presence.system` and `presence.board` are `protectedProcedure` queries with inputs `{ project, system }` and `{ project, board }`. They call the ops with `valkeyKv()` and `new Date()`. Register the router as `presence` in `appRouter`. The Task 9.1 test (every key is a router) now also covers `"presence"`; add `"presence"` to the list of allowed keys there.
- [ ] **Step 6: Run the tests.** Run `npx vitest run src/lib/ops/presence.test.ts src/lib/realtime`. Expected: PASS.
- [ ] **Step 7: Commit.** `feat(presence): track who is viewing a system and which agents are working on it`

### Task 9.6: Presence avatars on system pages and board cards

**Files:**
- Create: `src/components/presence/presence-stack.tsx`
- Create: `src/components/presence/presence-stack.test.tsx`
- Create: `src/components/presence/use-presence-heartbeat.ts`
- Modify: `src/app/(app)/p/[project]/systems/[system]/system-view.tsx` (heartbeat and stack in the header, next to the status control)
- Modify: `src/components/system-card.tsx` (small stack on cards)
- Modify: `src/components/board-view.tsx` (one `presence.board` query for the whole board, passed down to cards)

**Interfaces:**
- Consumes: `PresentPerson`, `PresentAgent`, the `presence.system` and `presence.board` queries, `PersonAvatar` (`src/components/person-avatar.tsx`), `Tooltip` (`@/components/ui/tooltip`).
- Produces:
  - `PresenceStack({ people, agents, max = 3, size = "sm" }: { people: PresentPerson[]; agents: PresentAgent[]; max?: number; size?: "xs" | "sm" })`
  - `usePresenceHeartbeat(project: string, system: string): void`

- [ ] **Step 1: Write failing render tests with `renderToStaticMarkup`, as in `src/components/markdown.test.tsx`.**
  - Empty people and agents render an empty string: the stack renders `null`.
  - Two people and one agent render three avatars, and the accessible text (an `sr-only` span) reads "Also here: Jules, Rik, Claude Code (for Ammo)".
  - Five people with `max` 3 render three avatars plus a "+2" chip, and the sr text lists all five.
  - The agent avatar is square (it has no `rounded-full` class) and carries a `Bot` icon. People avatars are round.

  Copy in this task is English; Task 9.13 moves it to messages.
- [ ] **Step 2: Run the tests to see them fail.** Expected: FAIL.
- [ ] **Step 3: Implement `PresenceStack`.**
  - Avatars overlap by `-space-x-1.5` with a `ring-2 ring-background`.
  - A tooltip on the stack lists names and "active N min ago" for agents. Use `relativeAge` for now; Task 9.13 swaps in the next-intl formatter.
  - Tide styling: agents use a square avatar on `bg-fg-2`, as in the review mockups.
- [ ] **Step 4: Implement `usePresenceHeartbeat`.**
  - On mount, `fetch("/api/presence", { method: "POST", body: JSON.stringify({ project, system }), keepalive: true })`, then every 30 000 ms while `document.visibilityState === "visible"`.
  - On `pagehide` and on unmount, `navigator.sendBeacon("/api/presence", JSON.stringify({ project, system, leaving: true }))`.
  - Errors are ignored.
- [ ] **Step 5: Wire it up.**
  - `system-view.tsx` calls the heartbeat hook and renders `PresenceStack` from `useQuery(trpc.presence.system.queryOptions(…, { refetchInterval: 30_000 }))`. Use a plain `useQuery`, not suspense, so presence never blocks the page.
  - `board-view.tsx` runs `presence.board` with the same interval and passes each card its entry.
  - Cards show `size="xs"`, `max={2}`, in the card's footer row.
  - Presence changes also arrive through the `"presence"` realtime key from Task 9.4.
- [ ] **Step 6: Check it by hand.** Open one system in two browsers signed in as different users, and each sees the other within about 2 s. Close one, and the avatar disappears within about 2 s (beacon) or at most 60 s (TTL). Run an agent tool call on that system through MCP, and the agent avatar appears.
- [ ] **Step 7: Run the tests, lint and typecheck.** Expected: PASS.
- [ ] **Step 8: Commit.** `feat(presence): show who else is on a system on its page and on board cards`

### Task 9.7: next-intl foundation, locale resolution and typing

**Files:**
- Create: `src/i18n/locale.ts`
- Create: `src/i18n/locale.test.ts`
- Create: `src/i18n/request.ts`
- Create: `src/i18n/request.test.ts`
- Create: `src/i18n/next-intl.d.ts`
- Create: `messages/en.json`, `messages/de.json`
- Create: `src/i18n/messages.test.ts`
- Create: `src/i18n/untranslated.test.ts` with `src/i18n/untranslated-pending.ts`
- Modify: `package.json` (`next-intl`), `next.config.ts` (plugin), `src/app/layout.tsx` (provider, `lang`)

**Interfaces:**
- Consumes: `getPref` (Part 1), `sessionActor`, `getDb`.
- Produces:
  - `LOCALES = ["en", "de"] as const`, `type Locale`, `DEFAULT_LOCALE: Locale = "en"`
  - `resolveLocale(pref: unknown, acceptLanguage: string | null): Locale`
  - `resolveTimeZone(pref: unknown): string` (default `"UTC"`)
  - `loadRequestConfig(opts: { db: Db; userId: string | null; acceptLanguage: string | null }): Promise<{ locale: Locale; timeZone: string; messages: Messages }>`
  - the `getRequestConfig` default export in `src/i18n/request.ts`
  - `PENDING_FILES: string[]`, the files not yet migrated, which shrinks to empty by Task 9.15

- [ ] **Step 1: Install and wire up.** Run `npm install next-intl@^<latest 4.x>`. In `next.config.ts`, wrap the config with `createNextIntlPlugin("./src/i18n/request.ts")` and keep `output: "standalone"` and `agentRules: false`.
- [ ] **Step 2: Write failing tests in `src/i18n/locale.test.ts`.**
  - `resolveLocale("de", null)` gives `de`.
  - `resolveLocale("en", "de-DE,de;q=0.9")` gives `en` (the preference wins).
  - `resolveLocale(undefined, "de-DE,de;q=0.9,en;q=0.8")` gives `de`.
  - `resolveLocale(undefined, "en;q=0.1, de;q=0.9")` gives `de` (q-values respected).
  - `resolveLocale(undefined, "fr-FR,fr")` gives `en`.
  - `resolveLocale("fr", "de")` gives `de` (an unsupported preference is ignored).
  - `resolveLocale(42, "!!!garbage")` gives `en`.
  - `resolveLocale(undefined, null)` gives `en`.
  - `resolveTimeZone("Europe/Berlin")` gives `Europe/Berlin`. `resolveTimeZone("Mars/Base")` gives `UTC`, checked against `Intl.supportedValuesOf("timeZone")`. `resolveTimeZone(undefined)` gives `UTC`.
- [ ] **Step 3: Implement `locale.ts`.** It is pure. Parse `Accept-Language` by splitting on commas, reading `;q=`, sorting by q descending and matching the primary subtag against `LOCALES`.
- [ ] **Step 4: Write failing tests in `src/i18n/request.test.ts`** with PGlite and `insertUser`.
  - A user with pref `locale: "de"` returns `locale` `de` and `messages.common` equal to `de.json`'s `common`.
  - No user and header `de` returns `de`.
  - A user with pref `timeZone: "Europe/Berlin"` returns that `timeZone`.
  - A user without a time zone pref returns `UTC`.
- [ ] **Step 5: Implement `loadRequestConfig`** by reading prefs, resolving and importing `../../messages/${locale}.json`. The default export `getRequestConfig(async () => …)` reads `headers()` (`accept-language`) and `sessionActor()`. Without a session (login page) `userId` is `null`. It returns `{ locale, timeZone, messages, now: new Date() }`.
- [ ] **Step 6: Declare the typing.** In `src/i18n/next-intl.d.ts`: `declare module "next-intl" { interface AppConfig { Locale: (typeof LOCALES)[number]; Messages: typeof import("../../messages/en.json") } }`. Message keys are then type-checked, so a typo in `t("…")` fails `npm run typecheck`.
- [ ] **Step 7: Start the message files** with a `common` namespace: `appName` ("Roadmap"), `save`, `cancel`, `delete`, `close`, `create`, `edit`, `loading`, `retry`, `search`, `somethingWentWrong`. Put the German values in `de.json` (Speichern, Abbrechen, Löschen, Schließen, Erstellen, Bearbeiten, Wird geladen …, Erneut versuchen, Suchen, Etwas ist schiefgelaufen.).
- [ ] **Step 8: Write the message tests in `src/i18n/messages.test.ts`.** Flatten both files to dotted keys.
  - The key sets are equal; on failure the message lists missing keys per file.
  - No value is an empty or whitespace-only string.
  - Per key, the set of ICU arguments (`{name}`, `{count, plural, …}` → `count`) is equal in `en` and `de`; extract them with a small regex over `{identifier` at argument positions.
  - Every `plural` in `de` has an `other` branch.
- [ ] **Step 9: Update the layout.**
  - Make `src/app/layout.tsx` async. It reads `getLocale()`, `getTimeZone()` and `getNow()` from `next-intl/server`, renders `<html lang={locale}>`, and wraps `ThemeProvider` in `<NextIntlClientProvider>`. next-intl 4 passes messages, locale, time zone and now to client components automatically; check the installed version's docs and pass them explicitly if needed.
  - The `ClockProvider` render clock stays; formatting in Task 9.13 uses `useNow()` from `src/components/clock.tsx` as the `now` argument, so relative times keep their hydration-safe clock.
  - Add a render test in `src/i18n/request.test.ts`: `renderToStaticMarkup(<NextIntlClientProvider locale="de" messages={de} timeZone="UTC"><Probe/></NextIntlClientProvider>)`, where `Probe` uses `useTranslations("common")("save")`, contains "Speichern".
- [ ] **Step 10: Add the untranslated-string guard in `src/i18n/untranslated.test.ts`.**
  - Scan every `.tsx` under `src/app` and `src/components`, except `src/components/ui/**`, `*.test.tsx` and `src/app/opengraph-image.tsx` (an image, English by design).
  - Flag JSX text nodes with a letter (regex `>\s*[A-Za-zÄÖÜäöü][^<>{}]*<` on source lines that are not comments), and string literals in the attributes `placeholder`, `aria-label`, `title`, `alt` and `label`.
  - Allowed without translation: the product name "Roadmap", single symbols and keyboard glyphs (`⌘K`, `/`), and anything in `ALLOWED_LITERALS` (a short list in the test file with a comment per entry).
  - Files in `PENDING_FILES` are skipped. Start `PENDING_FILES` with every matching file from `find src/app src/components -name "*.tsx" -not -path "*/ui/*"`, sorted. The area tasks remove their files.
  - A file that is listed in `PENDING_FILES` but no longer has offenders also fails the test ("remove X from PENDING_FILES"), so the list can't go stale.
- [ ] **Step 11: Run the tests, typecheck and build.** Run `npx vitest run src/i18n`, `npm run typecheck` and `npm run build`. Expected: PASS.
- [ ] **Step 12: Commit.** `feat(i18n): add next-intl with per-user locale and time zone`

### Task 9.8: Language and time zone preferences

**Files:**
- Modify: `src/server/trpc/routers/account.ts` (`setLocale`, `setTimeZone`)
- Create: `src/server/trpc/routers/account-prefs.test.ts` (or extend `src/server/trpc/router.test.ts`, following its caller pattern)
- Modify: `src/components/shell/user-area.tsx` (language radio group)
- Create: `src/components/shell/time-zone-sync.tsx` (mounted in `src/app/(app)/layout.tsx`)

**Interfaces:**
- Consumes: `setPref` (Part 1), `LOCALES`, `resolveTimeZone`.
- Produces:
  - `account.setLocale({ locale: Locale })`
  - `account.setTimeZone({ timeZone: string })`, which throws `InvalidError("Unknown time zone.")` when `resolveTimeZone(tz) !== tz`
  - `TimeZoneSync()`

- [ ] **Step 1: Write failing tests with the router caller pattern from `src/server/trpc/router.test.ts`.**
  - `setLocale({ locale: "de" })` stores pref `locale = "de"`.
  - `setLocale({ locale: "fr" })` fails with `BAD_REQUEST`.
  - `setTimeZone({ timeZone: "Europe/Berlin" })` stores it.
  - `setTimeZone({ timeZone: "Mars/Base" })` fails with `BAD_REQUEST` and the message "Unknown time zone."
- [ ] **Step 2: Run the tests to see them fail, implement the procedures, and run them again.** Expected: PASS.
- [ ] **Step 3: Add the language picker.** In `user-area.tsx`, add a "Language" label and a `DropdownMenuRadioGroup` with the items "English" and "Deutsch". Language names always appear in their own language and are not translated. On change, call `setLocale` then `router.refresh()`. The refresh re-renders with the new messages. If Part 0's scoped invalidation lets a mutation declare which routers it affects, declare `account` only.
- [ ] **Step 4: Add `TimeZoneSync`.** It is a client component rendering `null`. After mount, it compares `Intl.DateTimeFormat().resolvedOptions().timeZone` with the server's `useTimeZone()`. When they differ and the browser zone is valid, it calls `setTimeZone` once per session (guard with `sessionStorage` in try/catch) and then `router.refresh()`. This makes times local instead of UTC; Part 0 showed UTC times with a label, and this replaces that.
- [ ] **Step 5: Check it by hand.** Switch to Deutsch: after the refresh, the menu itself reads "Sprache". On a browser in Europe/Berlin, an activity time that showed `09:05` (UTC) shows `11:05` after the first load.
- [ ] **Step 6: Commit.** `feat(i18n): let people choose their language and use their time zone`

### Task 9.9: Terminology and extraction rules

Tasks 9.10–9.15 migrate the screens in six areas. They share these rules; read them before each area task.

**Namespaces:** one per screen or component family, in camelCase: `common`, `shell`, `login`, `home`, `errors`, `account`, `admin`, `notifications`, `board`, `systems`, `system`, `tasks`, `planning`, `documents`, `adrs`, `questions`, `activity`, `roadmap`, `overview`, `insight`, `pages`, `glossary`, `search`, `settings`, `integrations`, `presence`, `enums`. Keys are camelCase and describe the meaning, not the English wording (`board.emptyColumn`, not `board.noSystemsYet`).

**Enum display labels** go in `enums`, while stored values stay unchanged:
- `enums.role.owner|editor|viewer`
- `enums.priority.mvp|later|niceToHave`, mapping `"MVP"`, `"Later"`, `"Nice to have"` with a helper `priorityKey(value)` in `src/i18n/enums.ts`
- `enums.taskState.todo|doing|blocked|done`
- `enums.category.planning|todo|active|review|blocked|done`
- `enums.adrStatus.proposed|accepted|superseded`
- `enums.planningArea.failureModes|dependencies|scope|opsTesting`

Replace existing label maps such as `ROLE_LABEL` with `useTranslations("enums")`. Column names are user data and are not translated.

**Plurals:** ICU, e.g. `"memberCount": "{count, plural, one {# member} other {# members}}"`. This also fixes the "1 members" and "1 projects" plurals if Part 0 left any.

**Dates and times:** replace every UI use of `formatDate`, `formatTime`, `dayLabel` and `relativeAge` from `src/lib/time.ts`:
- `useFormatter().dateTime(d, { day: "numeric", month: "short" })`, adding `year` when it differs
- `format.dateTime(d, { hour: "2-digit", minute: "2-digit" })`
- `format.relativeTime(d, useNow())`
- day grouping keeps a date key and labels today and yesterday with `activity.today` and `activity.yesterday`

In server components use `getFormatter()`. Delete functions from `src/lib/time.ts` that no UI uses any more, together with their tests; keep any that agent-facing code uses.

**Numbers:** `format.number(n)`.

**Server components and metadata:** `getTranslations(namespace)`. Page `metadata` becomes `generateMetadata` using `getTranslations`.

**Toasts:** texts written in components are translated. Op error messages passed through (`error.message`) stay English.

**Worker-rendered notifications (Part 6):** in-app and push texts are rendered per recipient with `createTranslator({ locale, messages, namespace: "notifications" })` from next-intl, using the recipient's `locale` pref loaded in the delivery job. Discord channel messages stay English.

**German terminology.** Use exactly these terms; the German UI uses *du*.

| English | German |
| --- | --- |
| project | Projekt |
| board | Board |
| column | Spalte |
| system | System |
| task | Aufgabe |
| spec | Spezifikation |
| plan | Plan |
| planning (interview) | Planung (Planungsinterview) |
| decision / ADR | Entscheidung / ADR |
| question | Frage |
| progress update | Fortschrittsmeldung |
| activity | Aktivität |
| overview | Übersicht |
| roadmap | Roadmap |
| phase | Phase |
| domain | Bereich |
| release | Release |
| settings | Einstellungen |
| members | Mitglieder |
| owner / editor / viewer (roles) | Inhaber / Bearbeiter / Betrachter |
| owner (of a system or task) | Verantwortlich |
| API key | API-Schlüssel |
| sign in / sign out | Anmelden / Abmelden |
| needs attention | Braucht Aufmerksamkeit |
| my work | Meine Arbeit |
| notification | Benachrichtigung |
| mention | Erwähnung |
| agent | Agent |
| priority MVP / Later / Nice to have | MVP / Später / Optional |
| todo / doing / blocked / done (task) | Offen / In Arbeit / Blockiert / Erledigt |
| category planning / todo / active / review / blocked / done | Planung / Offen / Aktiv / Review / Blockiert / Erledigt |
| proposed / accepted / superseded | Vorgeschlagen / Angenommen / Ersetzt |
| gate / rule | Regel |
| swimlane | Bahn |
| saved view | Gespeicherte Ansicht |
| glossary | Glossar |
| page (project page) | Seite |

**Each area task follows the same steps:**
1. Remove the area's files from `PENDING_FILES` and run `npx vitest run src/i18n/untranslated.test.ts` to see the offenders listed (FAIL).
2. Add the keys to `messages/en.json` and `messages/de.json`, and replace the literals with `t("…")`.
3. Run `npx vitest run src/i18n` and `npm run typecheck` (PASS).
4. Add one render test for a representative component of the area in German, asserting a known German string, following the Probe pattern in Task 9.7.
5. Check the area's screens by hand in German at 400 px and 1280 px width: no clipped labels or overflowing buttons, since German words run longer. Fix with `min-w-0`, `truncate` or wrapping, never by shortening the German below its meaning.
6. Commit.

This task has no code and no commit of its own; the area tasks apply its rules.

### Task 9.10: Translate the shell, login, home and error screens

**Files (all Modify; the executor also covers any files Parts 0–8 added in these areas, found with `git ls-files src/app src/components`):**
- `src/app/login/page.tsx`, `src/app/login/sign-in-button.tsx`
- `src/components/shell/app-shell.tsx`, `app-sidebar.tsx`, `command-menu.tsx`, `shells.tsx`, `user-area.tsx`
- `src/app/(app)/(global)/home-view.tsx`, `project-grid.tsx`, `src/components/new-project-dialog.tsx`
- `src/components/page.tsx`, `src/components/chips.tsx`, `src/components/person-avatar.tsx`
- The Part 0 `error.tsx`, `not-found.tsx` and `loading.tsx` files
- Part 3's My work, team workload and project health components
- Part 3's keyboard shortcut help, if it is in the shell
- The root `src/app/layout.tsx` metadata (`SITE_DESCRIPTION` stays English for crawlers; the title template is fine)

**Interfaces:** namespaces `shell`, `login`, `home`, `errors`, `common`, `enums.role`.

- [ ] **Step 1:** Follow the Task 9.9 steps 1–3.
- [ ] **Step 2: Add a render test** in `src/components/shell/user-area.test.tsx`: in `de`, the menu trigger and label render and "Abmelden" appears. Render with the dropdown `open` or `defaultOpen`, or test a small extracted `UserMenuItems` component if the dropdown doesn't render its content statically.
- [ ] **Step 3:** Follow the Task 9.9 step 5 check: sidebar, command menu, home with and without projects, the login page with `Accept-Language: de`, and a 404 page.
- [ ] **Step 4: Commit.** `feat(i18n): translate the shell, login, home and error screens`

### Task 9.11: Translate account, admin and notification screens

**Files (Modify):**
- `src/app/(app)/(global)/settings/api-keys/*`, `src/components/api-key-manager.tsx`
- `src/app/(app)/(global)/admin/users/*`, `src/components/allowlist-manager.tsx`
- Part 5's sessions page, admin audit view and API key usage
- Part 6's notification center, notification settings (devices, rules, quiet hours) and service worker notification click texts, if any are rendered client-side
- Part 7's admin GitHub App page
- The Part 6 worker delivery job that renders in-app and push texts: switch it to `createTranslator` with the recipient's `locale` pref, per Task 9.9

**Interfaces:** namespaces `account`, `admin`, `notifications`, `integrations` (for the admin GitHub page).

- [ ] **Step 1:** Follow the Task 9.9 steps 1–3.
- [ ] **Step 2: Write a failing test** for the Part 6 delivery rendering: a notification for a recipient with pref `locale: "de"` produces a German title (for example "Jules hat deine Frage beantwortet"). A recipient without a pref gets English. Discord payloads are unchanged and in English.
- [ ] **Step 3: Implement it** by loading the recipient's pref in the delivery job and rendering with `createTranslator`. Run the Part 6 delivery tests and this one. Expected: PASS.
- [ ] **Step 4:** Follow the Task 9.9 steps 4–5 for the API keys page and the notification settings in German.
- [ ] **Step 5: Commit.** `feat(i18n): translate account, admin and notification screens`

### Task 9.12: Translate boards and the systems list

**Files (Modify):**
- `src/app/(app)/p/[project]/boards/**`, `src/components/board-view.tsx`, `src/components/system-card.tsx`
- `src/components/new-board-dialog.tsx`, `src/components/new-system-dialog.tsx`
- `src/app/(app)/p/[project]/systems/systems-view.tsx`, `src/app/(app)/p/[project]/systems/page.tsx`, `src/components/systems/systems-table.tsx`, `systems-toolbar.tsx`
- Part 3's swimlanes, card field picker, filter chips, saved views, bulk edit bar and "Move to…" menu
- `src/components/presence/presence-stack.tsx` (Task 9.6)

**Interfaces:** namespaces `board`, `systems`, `presence`, `enums.priority`, `enums.category`.

- [ ] **Step 1:** Follow the Task 9.9 steps 1–3.
- [ ] **Step 2: Update the Task 9.6 `presence-stack.test.tsx`** to render inside an English provider for the English assertions, and add a German case: the sr text begins "Auch hier:".
- [ ] **Step 3:** Follow the Task 9.9 steps 4–5, checking a board with collapsed columns and swimlanes in German on a phone width.
- [ ] **Step 4: Commit.** `feat(i18n): translate boards and the systems list`

### Task 9.13: Translate the system page

**Files (Modify):**
- `src/app/(app)/p/[project]/systems/[system]/system-view.tsx`
- `src/components/system/*`: `activity-feed.tsx`, `author.tsx`, `controls.tsx`, `header-actions.tsx`, `properties.tsx`, `rail.tsx`, `tabs.tsx`, and `text.ts` if it holds UI copy
- `src/components/task-list.tsx`, `planning-rounds.tsx`, `document-section.tsx`, `version-picker.tsx`, `system-editor.tsx`
- Part 2's checklists, estimates, dependencies, custom fields and blocked-reason dialog
- Part 4's diff view, outline, coverage map, reopen-area dialog and plan steps with task state
- Part 7's code links panel

**Interfaces:** namespaces `system`, `tasks`, `planning`, `documents`, `enums.taskState`, `enums.planningArea`.

- [ ] **Step 1:** Follow the Task 9.9 steps 1–3. This includes replacing `relativeAge`, `formatDate` and `formatTime` in `activity-feed.tsx` and `author.tsx` with the next-intl formatter plus `useNow()`.
- [ ] **Step 2: Add the relative-time hydration test** in `src/components/system/activity-feed.test.tsx`, covering Review Focus 5.
  - Render `ActivityFeed`, or the smallest component showing a relative time, inside `ClockProvider serverNow={fixed}` and a `de` provider with `timeZone="Europe/Berlin"` and `now={new Date(fixed)}`.
  - An entry 5 minutes before `fixed` renders "vor 5 Minuten" (whatever next-intl's `relativeTime` produces for `de`; assert on the formatter's own output computed in the test).
  - Rendering twice with the same inputs gives identical markup.
- [ ] **Step 3:** Follow the Task 9.9 steps 4–5, checking every system tab in German at 400 px, including the mobile bottom action bar.
- [ ] **Step 4: Commit.** `feat(i18n): translate the system page`

### Task 9.14: Translate decisions, questions, activity, roadmap, overview and reports

**Files (Modify):**
- `src/app/(app)/p/[project]/adrs/**`, `src/components/accept-adr-button.tsx`
- `src/app/(app)/p/[project]/questions/**`, `src/components/question-card.tsx`, `src/components/questions/ask-question-dialog.tsx`
- `src/app/(app)/p/[project]/activity/**`, `src/components/activity/timeline.tsx`, `filter-chip.tsx`, `url-tabs.tsx`
- `src/app/(app)/p/[project]/roadmap/**`, `src/app/(app)/p/[project]/overview-view.tsx`, `src/components/overview/attention-list.tsx`
- Part 8's progress chart (axis labels and legend), releases, release notes editor and decision map
- Part 4's project pages, glossary and search results
- `src/app/(app)/p/[project]/updates/page.tsx` and `members/page.tsx` redirect only, so there's nothing to translate; remove them from `PENDING_FILES` if they have no offenders

**Interfaces:** namespaces `adrs`, `questions`, `activity`, `roadmap`, `overview`, `insight`, `pages`, `glossary`, `search`, `enums.adrStatus`.

- [ ] **Step 1:** Follow the Task 9.9 steps 1–3. Activity day grouping switches to a date key plus `activity.today` and `activity.yesterday` labels, per Task 9.9.
- [ ] **Step 2: Add a render test for `AttentionList` in German**: the kind label for `decision` reads "Entscheidung".
- [ ] **Step 3:** Follow the Task 9.9 steps 4–5, checking the overview, activity, ADR detail and progress chart.
- [ ] **Step 4: Commit.** `feat(i18n): translate decisions, questions, activity, roadmap and reports`

### Task 9.15: Translate project settings and finish the guard

**Files (Modify):**
- `src/app/(app)/p/[project]/settings/**`: `settings-frame.tsx`, `general-view.tsx`, `boards/boards-view.tsx`, `members/members-view.tsx`, `structure/structure-view.tsx`
- `src/components/settings/settings-nav.tsx`, `board-name-form.tsx`, `src/components/project-settings.tsx`, `member-manager.tsx`, `structure-manager.tsx`, `column-editor.tsx`
- Part 2's custom field definitions
- Part 4's column rules (gates) editor
- Part 6's Discord project webhook settings
- Part 7's repo picker and manual webhook form
- `src/i18n/untranslated-pending.ts`

**Interfaces:** namespaces `settings`, `integrations`.

- [ ] **Step 1:** Follow the Task 9.9 steps 1–3.
- [ ] **Step 2: Empty the list.** `PENDING_FILES` must now be `[]`. Change `untranslated.test.ts` so it fails if `PENDING_FILES` is not empty ("every file is migrated; do not add files back"), so new screens added after v2 are caught.
- [ ] **Step 3: Run all checks.** Run the full suite: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:plugin`, `npm run build`. Expected: all PASS.
- [ ] **Step 4:** Follow the Task 9.9 step 5 for settings, then do a final pass over the whole app in German as a viewer and as an owner, fixing any overflow found.
- [ ] **Step 5: Commit.** `feat(i18n): translate project settings and guard against untranslated text`
