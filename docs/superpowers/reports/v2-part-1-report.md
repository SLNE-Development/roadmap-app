# Part 1 (platform): report

Branch `feat/v2`, commits `4eac660..c642deb`: 8 task commits plus 1 final-review fix commit. The gate is green: lint, typecheck, 327 unit tests, 13 Valkey integration tests, 26 plugin tests, build and build:worker. A real compose stack (app, worker, Postgres, Valkey) reported healthy. With Valkey stopped, health stayed at 200 with `valkey: "down"`.

## Tasks done
Tasks 1–8 are all done and each passed review. These needed a fix round:
- Task 2: `hset` swallowed transaction errors.
- Task 3: a race in `valkeyBus.subscribe`, plus a failed SUBSCRIBE that broke the channel.
- Task 7: a metrics scrape could hang while Valkey was down.
- Task 8: `METRICS_TOKEN` was missing from both compose files.

The Opus final review found three more problems, fixed in c642deb:
- Completed repeat jobs were never removed. Valkey runs with noeviction, so it would eventually fill up.
- A bus handler that throws crashed the process.
- Web-side Valkey calls would block forever while Valkey was down.

The same commit also covers these smaller items:
- The worker start log lists feed consumers.
- The metrics bigint cast is fixed.
- The metrics registry is now on `globalThis`.
- The Kv prefix is now `roadmap:kv:`.
- The feed lease is checked before each consumer.
- CI runs `build:worker`.
- BullMQ worker failed/error logs are added.

## Deviations from the plan
- **Seeded `feed_seen` (Task 6).** A new consumer that does not start from the beginning gets `feed_seen` seeded for the lookback window, so it really starts at the head. The plan's algorithm contradicted its own test here.
- **Two Valkey clients.** `getProducerValkey()` is a fail-fast client: no offline queue, 1 retry, 1 s timeout. It is the default for `bullQueue`, `valkeyKv`, `valkeyBus` publish and `pingValkey`. `getValkey()` (blocking) is now only used by BullMQ workers. The bus subscriber uses offline-queue options so it can (re)subscribe.
- **Kv prefix.** The default prefix is `roadmap:kv:` instead of `roadmap:`. With the old prefix, `roadmap:feed:lock` collided with BullMQ's key space.
- **Lease check.** The lease is checked and refreshed before each consumer, not once per tick.
- **Extra test hook.** `bullQueueRaw` takes an optional connection.
- **Package versions.** `ioredis ^5.11.1` and `bullmq ^5.81.5` are pinned to ^5 as the plan says, although newer majors exist (ioredis 6, bullmq 6).

## Decisions I made (rulings)
1. Integration tests and smoke runs used throwaway containers on free ports, never your dev DB or other projects' containers. If this is wrong, nothing is lost.
2. The stack check ran as a separate compose project, `roadmap-v2-check`, on ports 3100, 55433 and 56380, then was torn down. If this is wrong, the check may differ slightly from the default project.
3. From Task 4 on, I pipelined the next implementer during reviews and squashed fixes into their task commits with `--autosquash`. If this is wrong, a rebase conflict would need a manual fix (none happened).
4. Seeded `feed_seen` for the lookback window when a consumer is created (see above). If this is wrong, a consumer registered while a slow transaction is open could miss that one late row.
5. Added the producer/worker client split. If this is wrong, worker-side kv and queue calls fail fast during an outage instead of waiting; feed ticks retry.
6. Kv prefix `roadmap:kv:`. If this is wrong, the Part 6/7/9 presence, active and gh keys live under that prefix.
7. Per-consumer lease check. If this is wrong, the cost is one extra GET and SET per consumer per tick.
8. A load-bearing leftover from the final re-review (the default bus subscriber couldn't subscribe) was fixed with one extra fixup instead of being left open. If this is wrong, the cost was one more commit before the squash.

## Things you should know
- **Your local `.env` has no `VALKEY_URL`.** The app now requires it at start, so `npm run dev` will refuse to start until you add `VALKEY_URL=redis://localhost:6379` and run Valkey. `docker compose up -d postgres valkey` works if ports 5432/6379 are free; set `POSTGRES_PORT`/`VALKEY_PORT` otherwise.
- The stack check rebuilt the image tag `roadmap-app:local`. Your running `roadmap-app-roadmap-1` container uses `surf-roleplay-roadmap:local` and was not touched.
- A throwaway container `v2-check-valkey` (port 56379) is running for the integration tests. I'll stop it at the end.
- Flag for Parts 6 and 7: feed consumers should catch per-event errors instead of throwing the whole batch. A poison event otherwise blocks that consumer, retrying every second.

## Manual checks still to do
- Saving a task in the UI while Valkey is stopped (needs sign-in).
