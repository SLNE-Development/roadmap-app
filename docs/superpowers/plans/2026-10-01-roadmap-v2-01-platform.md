# roadmap-app v2 Part 1: Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the app the background infrastructure every later part builds on: a Valkey connection, key-value, queue and pub/sub abstractions with in-memory twins for tests, a BullMQ worker process built from the same image, a change feed that tails `change_log` and hands each new entry to registered consumers exactly once, per-user preferences, a metrics endpoint, and the Docker, compose and CI changes to run it all.

**Architecture:** The Next.js server and a new worker process share one codebase. The server writes to Postgres as before and only occasionally enqueues a job or publishes a message. The worker runs BullMQ `Worker`s for four queues and a feed loop that polls `change_log`. The feed keeps a cursor per consumer in Postgres, re-reads a short lookback window so rows that commit out of id order are not missed, and filters already-delivered ids through a `feed_seen` table so nothing is delivered twice. Everything that touches Valkey is reached through the `Kv`, `JobQueue` and `EventBus` interfaces. Tests use `memoryKv()`, `memoryQueue()` and `memoryBus()`; only `*.integration.test.ts` files talk to a real Valkey.

**Tech Stack:** Node 22, Next.js 16, Drizzle ORM on Postgres 17 (PGlite in tests), Valkey 8 (`valkey/valkey:8-alpine`), `ioredis` 5, `bullmq` 5, `esbuild` (worker bundle), `tsx` (worker dev mode), vitest 5.

**Spec:** none for v2. This plan implements Part 1 of `docs/superpowers/plans/2026-10-01-roadmap-v2-index.md` (read its Global Constraints and Shared names first). Anything this plan does not change behaves as in `docs/superpowers/specs/2026-09-29-roadmap-app-design.md`.

## Global Constraints

Everything in the index's Global Constraints applies. Specific to this part:

- Queue names are exactly `QUEUE = { feed: "feed", deliver: "deliver", github: "github", maintenance: "maintenance" }`. Every BullMQ queue uses the key prefix `roadmap`.
- BullMQ job ids use `-` as the separator, never `:`, and are never purely numeric. Example: `chg-1842-discord`.
- Valkey runs with `--maxmemory-policy noeviction`, because BullMQ requires it, plus `--appendonly yes --appendfsync everysec`.
- The ioredis client used by BullMQ `Worker`s is created with `maxRetriesPerRequest: null`, which BullMQ requires. Pub/sub subscriptions use a separate connection made with `.duplicate()`.
- Web requests never block on Valkey to complete a write. The change feed reads `change_log`, so ordinary ops need no Valkey at all. If Valkey is down, writes still succeed, and `/api/health` stays 200 while reporting `valkey: "down"`.
- Preferences are personal: `user_pref` writes are not recorded in `change_log`.
- The worker never runs migrations. The app applies them at start, and the worker's compose service waits for the app to be healthy.

## Review Focus

1. **The worker is down or Valkey restarts** (index item 1). The feed resumes from `feed_cursor`, which lives in Postgres, not Valkey. Deliveries recorded in `feed_seen` are not repeated. Pinned in Task 6: the tests "resumes from its cursor after a restart" and "does not redeliver after the Kv is replaced".
2. **Two change-log rows commit out of id order** (index item 2). A row with a lower id that becomes visible after a higher id was already delivered is still delivered once. Pinned in Task 6: the test "delivers a late lower id once".
3. **One consumer throws.** Its cursor stays put and it gets the same events on the next tick; the other consumers keep advancing. Pinned in Task 6: the test "isolates a failing consumer".
4. **Two worker replicas run at once** (a rolling deploy). Only one feed loop delivers in a given tick, because of the `feed:lock` lease. Pinned in Task 6: the test "only the lease holder delivers".
5. **`/api/metrics` without a token, or with the wrong one.** It answers 404 when `METRICS_TOKEN` is unset and 401 for a wrong or missing bearer, and never leaks queue names or counts. Pinned in Task 7.

---

### Task 1: Split unit and integration tests, and add Valkey to CI

**Files:**
- Modify: `vitest.config.mts`
- Create: `vitest.integration.config.mts`
- Modify: `package.json` (scripts)
- Modify: `.github/workflows/ci.yml`
- Create: `src/test/valkey.ts`

**Interfaces:**
- Produces: `npm run test:integration`, and `testValkeyUrl(): string` from `src/test/valkey.ts`. It returns `process.env.VALKEY_URL ?? "redis://localhost:6379"`.
- Produces: `uniquePrefix(): string` in `src/test/valkey.ts`, which returns `"test:" + newId() + ":"` so each integration test works in its own key space.

- [ ] **Step 1:** In `vitest.config.mts`, keep everything and add `exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"]` to `test` (import `configDefaults` from `vitest/config`).
- [ ] **Step 2:** Create `vitest.integration.config.mts`. It has the same `resolve.alias` block as `vitest.config.mts` and `test: { environment: "node", include: ["src/**/*.integration.test.ts"], fileParallelism: false, testTimeout: 30_000 }`, plus a one-line doc comment in the same style as the existing config.
- [ ] **Step 3:** Add these scripts to `package.json`:
  - `"test:integration": "vitest run --config vitest.integration.config.mts --passWithNoTests"`
  - `--passWithNoTests` stays until Task 2 adds the first integration test, then Task 2 removes it.
- [ ] **Step 4:** Create `src/test/valkey.ts` with `testValkeyUrl()` and `uniquePrefix()`, each with a doc comment.
- [ ] **Step 5:** In `.github/workflows/ci.yml`, change the `check` job:
  - Add `services.valkey` with `image: valkey/valkey:8-alpine`, `ports: ["6379:6379"]`, and `options: --health-cmd "valkey-cli ping" --health-interval 5s --health-timeout 3s --health-retries 10`.
  - Add the step `- run: npm run test:integration` with `env: { VALKEY_URL: redis://localhost:6379 }`, right after `npm test`.
- [ ] **Step 6:** Run `npm test`. Expected: the same 179+ tests pass.
- [ ] **Step 7:** Run `npm run test:integration`. Expected: exits 0 with "No test files found".
- [ ] **Step 8:** Commit: `test: split integration tests and run them against valkey in ci`.

### Task 2: Valkey client and the `Kv` store

**Files:**
- Create: `src/lib/valkey.ts`, `src/lib/kv.ts`
- Test: `src/lib/kv.test.ts`, `src/lib/kv.integration.test.ts`
- Modify: `package.json` (dependency `ioredis`)

**Interfaces:**
- Produces, in `src/lib/valkey.ts`:
  - `getValkey(): Redis`. This is the process-wide ioredis client, cached on `globalThis` as `roadmapValkey` (like `getDb`), created from `VALKEY_URL` with `{ maxRetriesPerRequest: null, lazyConnect: false }`. It throws `Error("VALKEY_URL is not set; see .env.example.")` when the variable is unset.
  - `closeValkey(): Promise<void>`, which calls `quit()` and clears the cache.
  - `pingValkey(): Promise<boolean>`, which returns `true` on `PONG` within 1000 ms and `false` on any error or timeout, without throwing.
- Produces, in `src/lib/kv.ts`:
  - `interface Kv { get(key: string): Promise<string | null>; set(key: string, value: string, ttlSeconds?: number): Promise<void>; setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean>; del(key: string): Promise<void>; hset(key: string, field: string, value: string, ttlSeconds?: number): Promise<void>; hgetall(key: string): Promise<Record<string, string>>; incr(key: string, ttlSeconds?: number): Promise<number> }`
  - `valkeyKv(opts?: { client?: Redis; prefix?: string }): Kv`, with default client `getValkey()` and default prefix `"roadmap:"`.
  - `memoryKv(now?: () => number): Kv`, where `now` defaults to `Date.now`.
- `setIfAbsent` is not in the index's shared-names table. It is added here for the feed lease (Task 6), and the parent will update the index.

- [ ] **Step 1:** Run `npm i ioredis@^5`.
- [ ] **Step 2: Write the failing unit tests** in `src/lib/kv.test.ts` against `memoryKv(clock)`, where `clock` is a mutable `let t = 0`:
  - `set("a","1")`, then `get("a")` → `"1"`. `get("missing")` → `null`.
  - `set("a","1",10)`, then `t = 9_999`: `get("a")` → `"1"`. At `t = 10_000`: `get("a")` → `null`.
  - `setIfAbsent("l","x",5)` → `true`. A second `setIfAbsent("l","y",5)` → `false`, and `get("l")` stays `"x"`. After `t` passes 5 s, `setIfAbsent("l","y",5)` → `true`.
  - `hset("h","f1","a")` and `hset("h","f2","b")`, then `hgetall("h")` → `{ f1: "a", f2: "b" }`. `hgetall("none")` → `{}`.
  - `hset("h","f","a",2)`: the TTL applies to the whole hash, so after 2 s `hgetall("h")` → `{}`.
  - `incr("c")` → 1, again → 2. `incr("c2", 1)` → 1, and after 1 s `incr("c2", 1)` → 1 again.
  - `del("a")`, then `get("a")` → `null`.
- [ ] **Step 3:** Run `npx vitest run src/lib/kv.test.ts`. Expected: FAIL, because the module is not found.
- [ ] **Step 4:** Implement `memoryKv` with a `Map<string, { value: string | Map<string,string>; expiresAt: number | null }>`. An expired entry counts as absent. `set` without a TTL clears any expiry. `hset` with a TTL sets the key's expiry; without one it keeps the existing expiry. `incr` with a TTL sets the expiry only when it creates the key.
- [ ] **Step 5:** Implement `valkeyKv`. Every key is `prefix + key`.
  - `set` uses `SET k v EX ttl`, or `SET k v` without a TTL.
  - `setIfAbsent` uses `SET k v NX EX ttl` and returns whether the reply was `"OK"`.
  - `hset` is `HSET`, plus `EXPIRE k ttl` in a `multi()` when a TTL is given.
  - `incr` is `INCR`, plus `EXPIRE k ttl NX` in the same `multi()` when a TTL is given.
- [ ] **Step 6:** Implement `src/lib/valkey.ts` as specified, doc-commented in the style of `src/db/client.ts`. It does not import `server-only`, because the worker imports it too.
- [ ] **Step 7:** Run `npx vitest run src/lib/kv.test.ts`. Expected: PASS.
- [ ] **Step 8:** Write `src/lib/kv.integration.test.ts`. It creates its own `new Redis(testValkeyUrl(), { maxRetriesPerRequest: null })` and `valkeyKv({ client, prefix: uniquePrefix() })`, and runs the same cases as Step 2 except the clock-driven expiry cases. Replace those with `set("a","1",1)`, wait 1100 ms, then `get("a")` → `null`. Quit the client in `afterAll`.
- [ ] **Step 9:** Remove `--passWithNoTests` from the `test:integration` script. With Valkey running (`docker run -d -p 6379:6379 valkey/valkey:8-alpine`), run `npm run test:integration`. Expected: PASS.
- [ ] **Step 10:** Commit: `feat(platform): add the valkey client and a kv store with an in-memory twin`.

### Task 3: Job queues and the event bus

**Files:**
- Create: `src/lib/queue.ts`, `src/lib/bus.ts`
- Test: `src/lib/queue.test.ts`, `src/lib/bus.test.ts`, `src/lib/queue.integration.test.ts`, `src/lib/bus.integration.test.ts`
- Modify: `package.json` (dependency `bullmq`)

**Interfaces:**
- Produces, in `src/lib/queue.ts`:
  - `export const QUEUE = { feed: "feed", deliver: "deliver", github: "github", maintenance: "maintenance" } as const;`
  - `export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];`
  - `export interface JobOptions { jobId?: string; delayMs?: number }`
  - `export interface JobQueue { add(jobName: string, data: unknown, opts?: JobOptions): Promise<void> }`
  - `export interface MemoryQueue extends JobQueue { jobs: { jobName: string; data: unknown; opts: JobOptions }[] }`
  - `export function memoryQueue(): MemoryQueue`
  - `export function bullQueue(name: QueueName, opts?: { connection?: Redis }): JobQueue`
  - `export function bullQueueRaw(name: QueueName): Queue`, the cached BullMQ `Queue`, used by metrics.
  - `export const DEFAULT_JOB_OPTIONS`: `{ attempts: 5, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 }`
- Produces, in `src/lib/bus.ts`:
  - `export interface EventBus { publish(channel: string, message: object): Promise<void>; subscribe(channel: string, handler: (message: object) => void): Promise<() => void> }`
  - `export function memoryBus(): EventBus`
  - `export function valkeyBus(opts?: { client?: Redis; prefix?: string }): EventBus`, where the default prefix is `"roadmap:"`.

- [ ] **Step 1:** Run `npm i bullmq@^5`.
- [ ] **Step 2: Write failing unit tests.**
  - `src/lib/queue.test.ts`:
    - `memoryQueue().add("x", {a:1})` records `{ jobName:"x", data:{a:1}, opts:{} }`.
    - Two `add` calls with the same `jobId: "chg-1-a"` record only one job, the way BullMQ ignores a duplicate job id.
    - `add("x", {}, { jobId: "chg:1" })` rejects with `Error("Job ids must not contain ':'")`.
    - `add("x", {}, { jobId: "42" })` rejects with `Error("Job ids must not be purely numeric")`.
  - `src/lib/bus.test.ts`:
    - `memoryBus()`: a handler subscribed to `project:p1` receives `{ keys: ["systems"] }` after `publish("project:p1", …)`.
    - A handler on `project:p2` receives nothing.
    - After calling the returned unsubscribe, the handler receives nothing.
    - Two handlers on one channel both receive the message.
- [ ] **Step 3:** Run `npx vitest run src/lib/queue.test.ts src/lib/bus.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement `validateJobId(id)` in `queue.ts`, shared by both queue implementations. It throws the two errors from Step 2.
- [ ] **Step 5:** Implement `memoryQueue()` and `memoryBus()`. `memoryBus` delivers synchronously within `publish`, in subscription order.
- [ ] **Step 6:** Implement `bullQueue(name)`:
  - A module-level `Map<QueueName, Queue>` of `new Queue(name, { connection: opts?.connection ?? getValkey(), prefix: "roadmap", defaultJobOptions: DEFAULT_JOB_OPTIONS })`.
  - `add` maps `delayMs` to BullMQ `delay` and `jobId` to `jobId`, after validating the id.
  - `bullQueueRaw` returns the same cached `Queue`.
- [ ] **Step 7:** Implement `valkeyBus()`:
  - `publish` does `PUBLISH prefix+channel JSON.stringify(message)` on `getValkey()`.
  - `subscribe` lazily creates one subscriber connection (`getValkey().duplicate()`) shared by all subscriptions of the bus, keeps a `Map<channel, Set<handler>>`, runs `SUBSCRIBE` on the first handler of a channel and `UNSUBSCRIBE` after the last one leaves, and parses messages with `JSON.parse` inside a try/catch. A malformed message is dropped with `console.warn`.
- [ ] **Step 8:** Run the unit tests. Expected: PASS.
- [ ] **Step 9: Integration tests.**
  - `queue.integration.test.ts`:
    - Create `bullQueue(QUEUE.maintenance, { connection })` on a dedicated connection.
    - `add("probe", {n:1}, { jobId: "probe-" + newId() })`, then `bullQueueRaw(QUEUE.maintenance).getJob(id)` returns data `{n:1}`.
    - Adding the same id twice leaves one job.
    - Remove the job in `afterAll`, then close the queue and connection.
  - `bus.integration.test.ts`: `valkeyBus({ prefix: uniquePrefix() })` delivers a published message to a subscriber within 1 s, and stops after unsubscribe.
- [ ] **Step 10:** Run `npm run test:integration`. Expected: PASS.
- [ ] **Step 11:** Commit: `feat(platform): add bullmq job queues and a valkey event bus`.

### Task 4: Per-user preferences

**Files:**
- Create: `src/db/schema/platform.ts` (this task adds `userPref`; Task 6 adds the feed tables to the same file)
- Modify: `src/db/schema/index.ts` (`export * from "./platform";`)
- Create: `src/lib/ops/prefs.ts`, `src/server/trpc/routers/prefs.ts`
- Modify: `src/server/trpc/router.ts` (register `prefs: prefsRouter`)
- Test: `src/lib/ops/prefs.test.ts`
- Migration: `npm run db:generate -- --name user-pref`

**Interfaces:**
- Table `user_pref` (`userPref`):
  - `user_id text not null references user(id) on delete cascade`
  - `key text not null`
  - `value jsonb not null`
  - `updated_at timestamptz not null default now()`
  - Primary key `(user_id, key)`.
- Produces, in `src/lib/ops/prefs.ts`:
  - `PREF_KEY = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/` with a maximum length of 128 characters, exported as `prefKeySchema = z.string().max(128).regex(PREF_KEY)`.
  - `MAX_PREF_BYTES = 8192`.
  - `getPref(db: Executor, userId: string, key: string): Promise<unknown | null>`
  - `getPrefs(db: Executor, userId: string, prefix: string): Promise<Record<string, unknown>>`, which returns every key that starts with `prefix`.
  - `setPref(db: Executor, actor: Actor, key: string, value: unknown): Promise<void>`
  - `deletePref(db: Executor, actor: Actor, key: string): Promise<void>`
- Produces the tRPC router `prefs`:
  - `get: query({ key }) → unknown | null`
  - `list: query({ prefix }) → Record<string, unknown>`
  - `set: mutation({ key, value })`
  - `delete: mutation({ key })`
  - All procedures are `protectedProcedure` and always act on `ctx.actor.userId`.

- [ ] **Step 1:** Add `userPref` to `src/db/schema/platform.ts` using `pgTable`, `jsonb`, `primaryKey` and `tz` from `./auth`, with a doc comment. Export it from `schema/index.ts`.
- [ ] **Step 2:** Run `npm run db:generate -- --name user-pref`. Expected: a new file `drizzle/0002_user-pref.sql`. The number follows whatever Part 0 generated, so it may be higher.
- [ ] **Step 3: Write failing tests** in `src/lib/ops/prefs.test.ts`, using `createTestDb()` and `insertUser`:
  - `setPref(db, a, "overview.panels", ["attention","updates"])`, then `getPref(db, a.userId, "overview.panels")` → the same array.
  - Setting the same key again overwrites the value and bumps `updated_at`.
  - `getPref` for another user's key → `null`. Prefs are per user.
  - `getPrefs(db, a.userId, "board.collapsed.")` after setting `board.collapsed.b1` and `board.collapsed.b2` returns both keys, and nothing else.
  - Key `"Bad Key"` → `InvalidError`.
  - A value whose `JSON.stringify` is longer than 8192 bytes → `InvalidError` with message `"A preference must be at most 8 KB."`.
  - `deletePref`, then `getPref` → `null`. Deleting a missing key does not throw.
  - Deleting the user cascades their prefs.
- [ ] **Step 4:** Run `npx vitest run src/lib/ops/prefs.test.ts`. Expected: FAIL.
- [ ] **Step 5:** Implement the ops:
  - `setPref` parses the key with `prefKeySchema`, measures `Buffer.byteLength(JSON.stringify(value))`, and upserts with `onConflictDoUpdate` on `(userId, key)`, setting `value` and `updatedAt: new Date()`.
  - No `logChange`, because prefs are personal.
  - The actor may only write their own prefs, since the functions take `actor.userId`.
- [ ] **Step 6:** Implement `prefsRouter`. Inputs are `z.object({ key: prefKeySchema })` and `z.object({ key: prefKeySchema, value: z.unknown() })`, and `list` takes `z.object({ prefix: z.string().max(128) })`. Register it in `router.ts` as `prefs`. The mutations use the scoped invalidation convention that Part 0 introduces, invalidating only the `prefs` router.
- [ ] **Step 7:** Run the prefs tests plus `npx vitest run src/server/trpc/router.test.ts`. Expected: PASS.
- [ ] **Step 8:** Commit: `feat(platform): store per-user preferences`.

### Task 5: The worker process, the job registry and the worker bundle

**Files:**
- Create: `src/lib/env.ts`
- Modify: `src/instrumentation.ts` (use `requireEnv(APP_REQUIRED_ENV)`)
- Modify: `src/db/client.ts` (add `closeDb()`)
- Create: `src/worker/deps.ts`, `src/worker/jobs.ts`, `src/worker/main.ts`, `src/worker/heartbeat.ts`, `src/worker/consumers/index.ts`, `src/worker/healthcheck.mjs`
- Create: `scripts/build-worker.mjs`
- Modify: `package.json` (scripts `build:worker` and `worker:dev`, devDependencies `esbuild` and `tsx`), `.gitignore` (`/dist`), `eslint.config.mjs` (ignore `dist/**`)
- Test: `src/worker/jobs.test.ts`, `src/lib/env.test.ts`, `src/worker/heartbeat.test.ts`

**Interfaces:**
- `src/lib/env.ts`:
  - `export const APP_REQUIRED_ENV = ["DATABASE_URL", "VALKEY_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"] as const;`
  - `export const WORKER_REQUIRED_ENV = ["DATABASE_URL", "VALKEY_URL"] as const;` Later parts append to both lists, for example `ENCRYPTION_KEY` in Part 6.
  - `export function requireEnv(names: readonly string[], env = process.env): void`. It throws `Error("<NAME> is not set; see .env.example.")` for the first missing or empty name.
- `src/db/client.ts` adds `closeDb(): Promise<void>`. It ends the postgres-js client that backs the cached database and clears the cache. Keep the client in the global cache next to the drizzle instance, as `{ db, client }`.
- `src/worker/deps.ts`:
  - `export interface WorkerDeps { db: Db; kv: Kv; bus: EventBus; queue: (name: keyof typeof QUEUE) => JobQueue; now: () => Date }`
  - `export function productionDeps(): WorkerDeps`, built from `getDb()`, `valkeyKv()`, `valkeyBus()`, `(n) => bullQueue(QUEUE[n])` and `() => new Date()`.
  - `export function testDeps(db: Db, overrides?: Partial<WorkerDeps>): WorkerDeps & { queues: Record<keyof typeof QUEUE, MemoryQueue> }`. It uses `memoryKv`, `memoryBus`, and one `memoryQueue()` per queue exposed as `queues`. It lives in `src/worker/deps.ts` so feature parts can import it in tests.
- `src/worker/jobs.ts`:
  - `export type JobHandler = (data: unknown, deps: WorkerDeps) => Promise<void>;`
  - `export function registerJob(queue: QueueName, jobName: string, handle: JobHandler): void`. It throws `Error("Job <queue>/<jobName> is already registered")` on a duplicate.
  - `export function registerRepeatable(queue: QueueName, jobName: string, schedule: { everyMs: number } | { cron: string }, data?: unknown): void`. The job must also be registered with `registerJob`, which `startWorkers` checks.
  - `export function runJob(queue: QueueName, jobName: string, data: unknown, deps: WorkerDeps): Promise<void>`. It throws `Error("No handler for job <queue>/<jobName>")` for an unknown job.
  - `export function registeredJobs(): { queue: QueueName; jobName: string }[]` and `registeredRepeatables()`.
  - `export async function startWorkers(deps: WorkerDeps, connection: Redis): Promise<() => Promise<void>>`. It creates one BullMQ `Worker` per queue that has handlers, with `prefix: "roadmap"`, concurrency `deliver: 5` and 1 for the others, and a processor that calls `runJob(queue, job.name, job.data, deps)`. For each repeatable it calls `new Queue(queue, …).upsertJobScheduler(\`${queue}-${jobName}\`, schedule mapped to { every } or { pattern }, { name: jobName, data })`. It returns a `stop()` that awaits `worker.close()` for every worker.
- `src/worker/heartbeat.ts`:
  - `export const HEARTBEAT_FILE = "/tmp/worker-alive"`
  - `export const HEARTBEAT_KEY = "worker:heartbeat"`
  - `export function beat(deps: WorkerDeps, writeFile: (path: string, data: string) => Promise<void>): Promise<void>`. It writes `deps.now().toISOString()` to the file and runs `kv.set(HEARTBEAT_KEY, iso, 30)`.
- `src/worker/consumers/index.ts` is a list of side-effect imports, one per feature module that calls `registerJob`, `registerRepeatable` or `registerFeedConsumer`. In Part 1 it imports only `../feed-prune` (Task 6). The header comment says later parts add one import line each.
- `src/worker/main.ts` starts the worker: `requireEnv(WORKER_REQUIRED_ENV)`, `import "./consumers"`, `productionDeps()`, `startWorkers`, `startFeed` (Task 6), and a heartbeat every 10 s. On `SIGTERM` or `SIGINT` it stops the feed, awaits `stop()`, then `closeValkey()` and `closeDb()`, and exits 0. After 30 s it force-exits 1. It logs one line at start: `worker started: queues=<list> consumers=<list>`.
- `scripts/build-worker.mjs` bundles with the esbuild JS API:
  - entry `src/worker/main.ts`, `bundle: true`, `platform: "node"`, `format: "esm"`, `target: "node22"`, output `dist/worker/worker.mjs`, plus the banner `import { createRequire } from "module"; const require = createRequire(import.meta.url);` so CommonJS dependencies work in ESM.
  - An inline plugin: `onResolve({ filter: /^server-only$/ })` resolves to the virtual empty module; `onResolve({ filter: /^@\// })` resolves to `path.resolve("src", p.slice(2))` with the `.ts` and `/index.ts` extensions; and `onResolve({ filter: /^[^./]/ })` marks every other bare specifier `external: true`.
  - It also copies `src/worker/healthcheck.mjs` to `dist/worker/healthcheck.mjs`.
  - Don't rely on `packages: "external"`: the explicit plugin makes the `@/` alias resolution unambiguous.
- `src/worker/healthcheck.mjs` is plain Node with no imports beyond `node:fs`. It exits 0 when `/tmp/worker-alive` has an mtime less than 30 s old, and 1 otherwise.
- Scripts:
  - `"build:worker": "node scripts/build-worker.mjs"`
  - `"worker:dev": "tsx watch --conditions=react-server --env-file=.env src/worker/main.ts"`. The `react-server` condition makes the `server-only` import a no-op under tsx.

- [ ] **Step 1:** Run `npm i -D esbuild tsx`.
- [ ] **Step 2: Write failing tests.**
  - `src/lib/env.test.ts`:
    - `requireEnv(["A","B"], { A: "1", B: "2" })` does not throw.
    - `{ A: "1" }` throws `"B is not set; see .env.example."`.
    - `{ A: "", B: "2" }` throws for `A`.
  - `src/worker/jobs.test.ts`:
    - Register `maintenance/ping` with a handler that records `data`. `runJob("maintenance","ping",{x:1}, deps)` → the handler got `{x:1}`.
    - `runJob` for an unknown name rejects with `"No handler for job maintenance/nope"`.
    - A duplicate `registerJob` throws.
    - `registerRepeatable` appears in `registeredRepeatables()` with its schedule.
    - Give each test a unique job name so the module-level registry does not collide between tests.
  - `src/worker/heartbeat.test.ts`: with `testDeps(db, { now: () => new Date("2026-10-01T10:00:00Z") })` and a recording `writeFile`, `beat` writes `"2026-10-01T10:00:00.000Z"` to `/tmp/worker-alive` and `kv.get("worker:heartbeat")` returns the same string.
- [ ] **Step 3:** Run them. Expected: FAIL.
- [ ] **Step 4:** Implement `env.ts` and switch `instrumentation.ts` to `requireEnv(APP_REQUIRED_ENV)`, deleting its local `REQUIRED` array. This adds `VALKEY_URL` to what the app requires.
- [ ] **Step 5:** Implement `closeDb()`, `deps.ts`, `jobs.ts`, `heartbeat.ts`, `consumers/index.ts` (the `../feed-prune` import is added in Task 6; until then the file holds only its header comment and `export {}`), `main.ts` and `healthcheck.mjs`. `main.ts` is not unit tested. It stays a thin composition of tested parts.
- [ ] **Step 6:** Implement `scripts/build-worker.mjs`, then add `/dist` to `.gitignore` and `"dist/**"` to the ESLint global ignores.
- [ ] **Step 7:** Run the tests. Expected: PASS.
- [ ] **Step 8:** Run `npm run build:worker`. Expected: `dist/worker/worker.mjs` and `dist/worker/healthcheck.mjs` exist, and `grep -c "from \"bullmq\"" dist/worker/worker.mjs` is at least 1, which shows bullmq stayed external.
- [ ] **Step 9: Smoke test.**
  - With Postgres and Valkey running locally, run `DATABASE_URL=… VALKEY_URL=redis://localhost:6379 node dist/worker/worker.mjs`. Expected: the "worker started" line; then Ctrl+C exits 0 within a few seconds.
  - Without `VALKEY_URL`: it exits 1 with `"VALKEY_URL is not set; see .env.example."`.
- [ ] **Step 10:** Run `npm run lint && npm run typecheck && npm test`. Expected: green.
- [ ] **Step 11:** Commit: `feat(worker): add the worker process, job registry and worker bundle`.

### Task 6: The change feed

**Files:**
- Modify: `src/db/schema/platform.ts` (add `feedCursor` and `feedSeen`)
- Create: `src/worker/feed.ts`, `src/worker/feed-prune.ts`
- Modify: `src/worker/consumers/index.ts` (import `../feed-prune`), `src/worker/main.ts` (call `startFeed`)
- Test: `src/worker/feed.test.ts`
- Migration: `npm run db:generate -- --name change-feed`

**Interfaces:**
- Table `feed_cursor` (`feedCursor`):
  - `name text primary key`
  - `last_id bigint not null`, as `bigint("last_id", { mode: "number" })`
  - `updated_at timestamptz not null default now()`
- Table `feed_seen` (`feedSeen`):
  - `consumer text not null`
  - `change_id bigint not null` (mode number)
  - `seen_at timestamptz not null default now()`
  - Primary key `(consumer, change_id)`, and index `feed_seen_seen_at` on `seen_at`.
- Produces, in `src/worker/feed.ts`:
  - `export type ChangeEvent = typeof changeLog.$inferSelect`, whose fields are `id, projectId, systemId, entity, entityId, field, oldValue, newValue, authorUserId, agent, createdAt`, matching the index.
  - `export type FeedHandler = (events: ChangeEvent[], deps: WorkerDeps) => Promise<void>;`
  - `export interface FeedConsumer { name: string; handle: FeedHandler; fromStart?: boolean }`
  - `export function registerFeedConsumer(name: string, handle: FeedHandler, opts?: { fromStart?: boolean }): void`. It throws on a duplicate name.
  - `export function registeredFeedConsumers(): FeedConsumer[]`
  - `export const FEED_DEFAULTS = { batchSize: 200, lookbackMs: 5 * 60_000, lookbackIds: 5_000, intervalMs: 1_000, leaseSeconds: 10 }`
  - `export async function runFeedTick(deps: WorkerDeps, consumers: FeedConsumer[], opts?: Partial<typeof FEED_DEFAULTS> & { holder?: string }): Promise<{ consumer: string; delivered: number; error?: string }[] | null>`. It returns `null` when another holder has the lease.
  - `export function startFeed(deps: WorkerDeps, consumers?: FeedConsumer[], opts?: Partial<typeof FEED_DEFAULTS>): () => Promise<void>`. It loops `runFeedTick` with `setTimeout(intervalMs)`, runs again immediately while a tick delivered a full batch, and resolves `stop()` after the current tick finishes.
- Produces, in `src/worker/feed-prune.ts`: it registers the job `maintenance/feed-prune`, which deletes `feed_seen` rows with `seen_at < now() - 15 minutes`, and `registerRepeatable(QUEUE.maintenance, "feed-prune", { everyMs: 5 * 60_000 })`.

**Algorithm of `runFeedTick`:** keep to this exactly.
1. **Lease.** Call `kv.setIfAbsent("feed:lock", holder, leaseSeconds)`. If it returns false and `kv.get("feed:lock") !== holder`, return `null`. If this holder already owns the lease, refresh it with `kv.set("feed:lock", holder, leaseSeconds)`. `holder` defaults to a per-process `newId()`.
2. **Consumers,** one after another. For each consumer:
   1. **Load or initialise its cursor.** When no row exists, insert `last_id = fromStart ? 0 : coalesce(max(change_log.id), 0)`, so a new consumer does not replay history unless it asks to.
   2. **Select candidates:** `change_log` rows where `id > cursor`, or where `id > cursor - lookbackIds` and `created_at > now() - lookbackMs`, with no `feed_seen` row for this consumer (`NOT EXISTS`). Order by `id` and limit to `batchSize`.
   3. If there are no candidates, record `{ consumer, delivered: 0 }` and continue.
   4. **Deliver.** `await consumer.handle(events, deps)`.
      - If it throws, record `{ consumer, delivered: 0, error: message }`, `console.error` it, and do not touch the cursor or `feed_seen`. The same events come again on the next tick.
      - Otherwise, in one transaction, insert a `feed_seen` row for every delivered id with `ON CONFLICT DO NOTHING`, and set `last_id = max(last_id, max delivered id)` and `updated_at = now()`.
3. Return the per-consumer results.

Delivery is at least once. A crash between `handle` and the transaction redelivers, so consumers must be idempotent, keyed by `event.id`. This is stated in the doc comment of `registerFeedConsumer`.

- [ ] **Step 1:** Add the two tables to `src/db/schema/platform.ts` and run `npm run db:generate -- --name change-feed`.
- [ ] **Step 2: Write failing tests** in `src/worker/feed.test.ts`. Use `createTestDb()`, `createProjectFixture`, and a helper `addChange(db, projectId, field)` that calls `logChange(db, owner, { projectId, entity: "system", entityId: "s", field })`. Each test passes its own `consumers` array, so the module registry is never involved. Deps come from `testDeps(db)`, and a recording consumer is `{ name: "rec", handle: async (evts) => got.push(...evts.map(e => e.id)) }`.
  - **"starts at the head":** 3 changes exist, then the first tick → `got = []`. Add 1 change, then tick → `got` is that one id.
  - **"fromStart replays":** 3 changes exist, and a consumer with `fromStart: true` gets all 3 on its first tick, in id order.
  - **"resumes from its cursor after a restart":** deliver 2 changes, then call `runFeedTick` again with brand-new deps (a new `memoryKv`) on the same db → nothing. Add 1 change → only the new id.
  - **"does not redeliver after the Kv is replaced":** a consumer with `fromStart: true` has delivered ids 1–3. Replace `kv` and tick → nothing.
  - **"delivers a late lower id once":**
    - Insert a change with an explicit id: `db.insert(changeLog).values({ id: 100, … })`. Tick → `[100]`.
    - Insert id `95` with `createdAt: new Date()` and tick → `[95]`.
    - Tick again → nothing.
    - Insert id `50` with `createdAt` 10 minutes ago, which is outside `lookbackMs`, and tick → nothing. This is documented as the limit: only transactions shorter than the lookback are covered.
  - **"batches in id order":** a consumer with `fromStart: true` and `batchSize: 200`, with 450 changes, gets 200, 200 and 50 events in three ticks, with strictly increasing ids across them.
  - **"isolates a failing consumer":** consumer A throws on its first call and consumer B records. Tick 1: B gets the event, and the result for A has `error`. Tick 2: A gets the same event, and B gets nothing new.
  - **"only the lease holder delivers":** two ticks on shared deps with `holder: "h1"` and `holder: "h2"`. The second returns `null`, and the event is delivered once. After the lease expires (use `memoryKv(clock)` and advance the clock by 11 s), `h2` can tick.
  - **"feed-prune removes old seen rows":** insert a `feed_seen` row with `seen_at` 20 minutes ago and another one now. `runJob("maintenance","feed-prune",{},deps)` leaves only the recent one.
- [ ] **Step 3:** Run `npx vitest run src/worker/feed.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement `feed.ts` following the algorithm.
  - Write the candidate query with drizzle's `sql` for the `OR` and `NOT EXISTS`.
  - Compute `now() - lookbackMs` in the query as `now() - make_interval(secs => ${lookbackMs / 1000})`, so both PGlite and Postgres use their own clock.
  - Doc-comment every export.
- [ ] **Step 5:** Implement `feed-prune.ts`, and add `import "../feed-prune";` to `consumers/index.ts`.
- [ ] **Step 6:** In `main.ts`, call `startFeed(deps)` after `startWorkers`, and await its stop on shutdown before `stop()`.
- [ ] **Step 7:** Run the feed tests, then `npm test`. Expected: PASS.
- [ ] **Step 8:** Commit: `feat(worker): tail change_log as a change feed with per-consumer cursors`.

### Task 7: Health that reports Valkey and the worker, and `/api/metrics`

**Files:**
- Modify: `src/app/api/health/route.ts`
- Create: `src/lib/metrics.ts`, `src/app/api/metrics/route.ts`
- Test: `src/lib/metrics.test.ts`, `src/app/api/metrics/route.test.ts`, `src/app/api/health/route.test.ts`

**Interfaces:**
- `/api/health` GET → JSON `{ ok: boolean, db: "up" | "down", valkey: "up" | "down", worker: "up" | "stale" | "unknown" }`.
  - `ok` and the status (200 or 503) depend only on `db`, so a Valkey outage does not make Docker restart the app.
  - `worker` is `"up"` when `HEARTBEAT_KEY` holds a time less than 30 s old, `"stale"` when it is older or missing while Valkey is up, and `"unknown"` when Valkey is down.
  - Export a testable `healthReport(deps: { db: Db; ping: () => Promise<boolean>; kv: Kv; now: () => Date })` and keep `GET` as a thin wrapper.
- `src/lib/metrics.ts`:
  - `export interface Metric { name: string; help: string; type: "gauge" | "counter"; collect: () => Promise<{ labels?: Record<string, string>; value: number }[]> }`
  - `export function registerMetric(metric: Metric): void`, which throws on a duplicate name.
  - `export async function renderMetrics(metrics?: Metric[]): Promise<string>`. It renders Prometheus text format 0.0.4: `# HELP`, `# TYPE`, then one line per sample, with labels escaped (`\`, `"` and newline). A collector that throws renders only `# HELP` and `# TYPE` and logs the error, and the rest still render.
  - Built-in metrics are registered by `registerBuiltinMetrics(deps: { db: Db; kv: Kv; queueCounts: (q: QueueName) => Promise<Record<string, number>>; pingValkey: () => Promise<boolean> })`:
    - `roadmap_db_up` (gauge, 0 or 1)
    - `roadmap_valkey_up` (gauge)
    - `roadmap_worker_up` (gauge, from the heartbeat, less than 30 s old)
    - `roadmap_queue_jobs{queue,state}` (gauge, states `waiting,active,delayed,failed` from `bullQueueRaw(q).getJobCounts(...)`)
    - `roadmap_feed_lag{consumer}` (gauge: `max(change_log.id) - feed_cursor.last_id`)
    - `roadmap_feed_cursor{consumer}` (gauge)
  - Part 5 registers tool-call counters through the same `registerMetric`.
- `/api/metrics` GET:
  - Without `METRICS_TOKEN` → 404 with an empty body.
  - With a missing, malformed or wrong `Authorization: Bearer` header → 401 with body `{"error":"Missing or invalid metrics token."}`. Compare the token with `crypto.timingSafeEqual` over equal-length buffers.
  - Otherwise → 200, `content-type: text/plain; version=0.0.4`, with the rendered text.
  - The route has `export const dynamic = "force-dynamic"`. The `proxy.ts` matcher already skips `api/`.

- [ ] **Step 1: Write failing tests.**
  - `metrics.test.ts`:
    - A gauge with the samples `[{labels:{queue:"deliver",state:"waiting"},value:3}]` renders exactly:

      ```
      # HELP roadmap_queue_jobs Jobs per queue and state.
      # TYPE roadmap_queue_jobs gauge
      roadmap_queue_jobs{queue="deliver",state="waiting"} 3
      ```

    - A label value `a"b\c` renders as `a\"b\\c`.
    - A throwing collector still lets the other metrics render.
    - `roadmap_feed_lag` for a consumer at `last_id 5`, when `max(change_log.id)` is 8 → `roadmap_feed_lag{consumer="rec"} 3`.
  - `route.test.ts` (metrics): export `handleMetrics(request: Request, env: { METRICS_TOKEN?: string }, render: () => Promise<string>)` and test it directly:
    - no token configured → 404
    - no header → 401
    - `Bearer wrong` → 401
    - `Bearer <token>` → 200 with the body from `render`
  - `route.test.ts` (health), through `healthReport`:
    - db up, valkey down → `{ ok: true, db: "up", valkey: "down", worker: "unknown" }`
    - a heartbeat 10 s old → `worker: "up"`
    - 40 s old → `"stale"`
    - db failing (pass a db whose `execute` throws) → `ok: false`, and GET would send 503
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement `metrics.ts`, the metrics route (it registers the built-ins once on first request through a module-level flag, using `bullQueueRaw(q).getJobCounts("waiting","active","delayed","failed")`), and the new health route.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ops): report valkey and worker health and serve prometheus metrics`.

### Task 8: Docker image, compose files, Next tracing, env and README

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `docker-compose.coolify.yml`, `next.config.ts`, `.env.example`, `README.md`, `.dockerignore` (keep `dist` out of the context)

**Interfaces:**
- `next.config.ts` adds:
  - `serverExternalPackages: ["bullmq", "ioredis"]`
  - `outputFileTracingIncludes: { "/**": ["./node_modules/bullmq/dist/**"] }`

  BullMQ reads its command scripts from its package directory at runtime. This makes sure the standalone output contains them.
- The image layout:
  - `/app/server.js` (Next standalone, as today)
  - `/app/worker/worker.mjs` and `/app/worker/healthcheck.mjs`
  - `/app/worker/node_modules` (production dependencies)
  - `/app/drizzle`
  - The default `CMD` stays `["node", "server.js"]`. The worker service overrides the command.

- [ ] **Step 1:** In `Dockerfile`:
  - Add a stage `prod-deps` (`FROM node:22-bookworm-slim`, `WORKDIR /app`, copy `package.json` and `package-lock.json`, `RUN npm ci --omit=dev`).
  - In the `build` stage, run `npm run build && npm run build:worker`.
  - In the `runtime` stage, add `COPY --from=build --chown=node:node /app/dist/worker ./worker` and `COPY --from=prod-deps --chown=node:node /app/node_modules ./worker/node_modules`.
  - Keep the app `HEALTHCHECK`. It only applies to the app container, because compose overrides it for the worker.
- [ ] **Step 2:** Update `next.config.ts` as specified, keeping the doc comment accurate. Then run `npm run build`. Expected: success, and `.next/standalone/node_modules/bullmq/dist` exists (check with `ls`).
- [ ] **Step 3:** In `docker-compose.yml`:
  - Add service `valkey`:
    - `image: valkey/valkey:8-alpine`
    - `command: ["valkey-server", "--appendonly", "yes", "--appendfsync", "everysec", "--maxmemory", "64mb", "--maxmemory-policy", "noeviction"]`
    - `ports: ["${VALKEY_PORT:-6379}:6379"]`, volume `roadmap-valkey:/data`
    - `healthcheck: test ["CMD", "valkey-cli", "ping"]`, interval 10 s, timeout 5 s, retries 5
    - `mem_limit: 96m`, `cpus: 0.25`, `restart: unless-stopped`
  - Add `VALKEY_URL: redis://valkey:6379` to `app`, and make `app` depend on `valkey` being healthy.
  - Add service `worker` with `profiles: ["app"]`:
    - `image: roadmap-app:local` (reusing the app's build) and `command: ["node", "worker/worker.mjs"]`
    - `environment: DATABASE_URL` and `VALKEY_URL`, the same values as `app`
    - `depends_on: app: service_healthy, valkey: service_healthy`
    - `healthcheck: test ["CMD", "node", "worker/healthcheck.mjs"]`, interval 30 s, timeout 5 s, retries 3, start_period 20 s
    - `stop_grace_period: 40s`, `mem_limit: 256m`, `restart: unless-stopped`
  - Add the `roadmap-valkey` volume.
- [ ] **Step 4:** In `docker-compose.coolify.yml`:
  - Add the same `valkey` service with `--requirepass ${SERVICE_PASSWORD_VALKEY}` appended to the command, and a healthcheck of `["CMD-SHELL", "valkey-cli -a \"$SERVICE_PASSWORD_VALKEY\" ping | grep PONG"]` with `environment: - SERVICE_PASSWORD_VALKEY`.
  - Set `VALKEY_URL=redis://default:${SERVICE_PASSWORD_VALKEY}@valkey:6379` on `app` and `worker`.
  - Add the `worker` service on `image: ghcr.io/slne-development/roadmap-app:latest`, with the same command, healthcheck and limits as the local file.
  - Update the header comment to mention Valkey and the worker.
- [ ] **Step 5:** In `.env.example`, add:
  - `VALKEY_URL=redis://localhost:6379` with the comment `# Valkey (Redis-compatible) used for background jobs, caching and live updates.`
  - `METRICS_TOKEN=` with the comment `# Bearer token for /api/metrics (Prometheus). Leave empty to disable the endpoint.`
- [ ] **Step 6:** In `README.md`:
  - Add `VALKEY_URL` (required) and `METRICS_TOKEN` (optional) rows to the Configuration table.
  - Change "Run locally" to `docker compose up -d postgres valkey`, then `npm run dev` and, in a second terminal, `npm run worker:dev`.
  - Add `npm run test:integration` (needs Valkey) to the checks line.
  - Add a short paragraph to the Coolify section: the stack now has `app`, `worker`, `postgres` and `valkey`; Coolify generates `SERVICE_PASSWORD_VALKEY`; and only `app` gets a domain.
- [ ] **Step 7:** Build and run the stack: `docker compose --profile app up -d --build`. Expected:
  - all four services report healthy within 2 minutes (`docker compose ps`)
  - `curl localhost:3000/api/health` → `{"ok":true,"db":"up","valkey":"up","worker":"up"}`
  - `docker compose logs worker` shows `worker started: queues=maintenance consumers=`
- [ ] **Step 8:** Stop Valkey (`docker compose stop valkey`). Expected: `/api/health` → 200 with `"valkey":"down","worker":"unknown"`, and saving a task in the UI still works. Start it again afterwards.
- [ ] **Step 9:** Run `npm run lint && npm run typecheck && npm test && npm run test:plugin && npm run build && npm run build:worker`. Expected: green.
- [ ] **Step 10:** Commit: `build: run valkey and the worker in docker and coolify`.
