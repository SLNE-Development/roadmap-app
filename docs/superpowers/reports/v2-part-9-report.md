# Part 9 (realtime, presence and i18n): report

Branch `feat/v2`. Part 9 commits, in order:
- **Realtime:** 1b553ca, 1eb7232, d8863ec, 929bdf8 (9.1–9.4)
- **next-intl:**
  - 5ed1d53: the foundation (9.7)
  - 8386b33: messages split per namespace
  - 06d6240: language and time zone (9.8)
- **Presence:** 2875a16 (9.5) and 9af7f60 (9.6)
- **Translations:**
  - 831442a: prep, which split the work per area
  - db1d8b3: settings (9.15)
  - 43136d8: account, admin and notifications (9.11)
  - d09bc15: shell, login, home and errors (9.10)
  - 6bf92ef: boards and the systems list (9.12)
  - 0b88689: decisions, questions, activity, roadmap and reports (9.14)
  - e988d84: the system page (9.13)
  - 74d4555: the guard against untranslated text (9.15, finish)
- **Final-review fixes:** f37ed1e and 7982481

The Part 8 fix commit a02ff1c and the docs commit 894494c sit in this range because the parts overlapped. Gate green after the final fixes: lint, typecheck, 1343 tests, 38 plugin tests, 14 Valkey integration tests, `check:worker-imports`, build and build:worker. No migration. New dependencies: `next-intl` and `use-intl`.

## Tasks done
All 15 tasks are done and each passed review:
1. Invalidation map and realtime feed consumer
2. Per-process subscription hub
3. SSE endpoint `/api/events/[project]`
4. Client subscription with debounced invalidation
5. Presence heartbeat and queries
6. Presence avatars on system pages and board cards
7. next-intl foundation, locale resolution and typing
8. Language and time zone preferences (account menu → Language; the time zone follows the browser)
9. Terminology and extraction rules (no code)
10–15. Every screen translated into German. `PENDING_FILES` is now empty, and the guard test fails if a file is added back.

**Fix rounds:**
- **9.3:** hardened the stream so only `{keys}` leave the server, and access recheck failures are logged consistently.
- **9.6:** a tab coming back from the background, or restored from the back/forward cache, now sends its heartbeat straight away. Before, it stayed invisible to others for up to 30 s.
- **9.7:**
  - Valid time zones such as Asia/Kolkata were rejected and fell back to UTC.
  - The guard missed text split across several JSX lines.
- **9.11:** agent-written notification titles mixed languages ("Claude for Jules hat dich … erwähnt"). The actor label is now built per language.
- **9.14:**
  - Activity sentences and the overview attention list were built as English text in library code. They are now built from structured data and translated in the browser, while agents keep English.
  - ADR "edited" entries showed raw field names. They now show the section labels.

**The Opus final review found two important problems, fixed in f37ed1e and 7982481:**
- **Board rule chips never refreshed live.** `gates` was missing from the realtime invalidation map, so ticking off the last task didn't update "Review 2/3" on other people's boards.
- **English text built in library code reached the German UI.** This hit the project health tooltips on the home page and the planning coverage "Thin: …" reasons. Both now carry reason codes that the UI translates.

**The same fixes also did these:**
- **Valkey outages:**
  - A stream opened while Valkey is down now pings and cleans up when it is aborted, instead of hanging.
  - The presence error log is throttled.
  - The worker waits up to a few seconds for Valkey before its first tick. That first tick failing ("Stream isn't writeable") predates Part 9.
- **Notifications:**
  - The test push is in the recipient's language.
  - The worker bundle now carries only the notification messages.
  - The actor fallback is translated.
- **German wording:**
  - Planning areas are "Planungsbereich", because "Bereich" means domain.
  - Where one English term had two German translations, I picked one each: "Verknüpfung lösen", "geklärt", "GitHub-App", "Agenten".
- **Other:**
  - The sessions list translates device names, and the section-link aria-label is translated.
  - The README documents language, time zone and presence, and how to add UI text.
  - A new `npm run check:worker-imports` loads the worker's code the way the dev worker does.

## Deviations from the plan
- **Message files.** Messages live in `messages/<locale>/<namespace>.json`, not one `en.json`/`de.json`. A typed index per language merges them. This let six agents translate in parallel without editing the same file.
- **Translation prep.**
  - A prep commit split the "not yet translated" list into one file per area and pre-created every namespace.
  - It filled `enums` and `priorityKey` and seeded `common`.
  - The per-area files were removed at the end.
- **Pages the plan didn't name** were assigned by path:
  - agents pages → reports, translated under `activity.agents.*`
  - archive banner → shell
  - glossary settings → settings
  - mention box → system page

  The admin GitHub page uses `admin.github.*`, because `integrations` belonged to settings.
- **Presence avatars on cards.** The board renders its own card component, so the avatars sit there. The separate `system-card.tsx` got an optional prop that the systems list doesn't use yet.
- **Notifications** are translated when they are created, in the recipient's language, and stored that way. Push reuses the stored text, so old notifications keep their language after a switch.
- **Activity day headings** stay UTC with the "Days in UTC" caption, while row times use the user's time zone, per the UTC ruling. The system page's own feed groups by the user's time zone; both are hydration-safe.
- **Removed English helpers** now that no screen uses them:
  - `formatDate`, `formatTime`, `dayLabel` and `relativeAge`
  - the chips label maps
  - `CARD_FIELD_LABELS`
  - `DISCORD_EVENT_LABEL`
  - the old board announcer helpers
- **Worker translation import.** The worker uses `createTranslator` from `use-intl/core`, not from `next-intl`. Under the dev worker's `react-server` condition, `next-intl` loads React's client provider and crashes. `npm run build:worker` uses different resolution, so the gate didn't catch it. The dev worker did.

## Decisions I made (rulings)
1. Ruling: data stays UTC (chart buckets, day keys, CSV); single timestamps use the user's time zone via next-intl, with identical server and client inputs — cost if wrong: chart labels and timestamps follow different zones (documented in the UI).
2. Ruling: the realtime consumer registers in `src/worker/consumers/index.ts` — cost if wrong: none.
3. Ruling: notifications are translated per recipient at notify time; Discord stays English — cost if wrong: an old notification isn't re-translated after a language change.
4. Ruling: messages are split per namespace, with a typed index per language — cost if wrong: more files.
5. Ruling: the six translation areas ran in parallel after a prep commit; agents touched only their own namespaces and lists, and `common` was read-only — cost if wrong: a few duplicated strings across namespaces.
6. Ruling: pages the plan didn't name were assigned to areas by path (see Deviations) — cost if wrong: none.
7. Ruling: stored release notes stay English (written once when a release ships, editable afterwards) — cost if wrong: German teams edit the notes by hand.
8. Ruling: stored push-device labels ("Chrome on Windows") stay English; they are saved when you subscribe — cost if wrong: one English label per device in the German settings.

## Parked minor findings
- **Presence:**
  - In React's dev double-render, a leave beacon can land after the next heartbeat. You then look absent for up to 30 s, in development only.
  - On a card (max 2 avatars), agents fold into "+N" when two people are present.
  - The avatar tooltip can't be reached with the keyboard, though the screen reader text covers it.
  - The board's presence query costs one Valkey read per system.
- **Notifications:** the language preference is one extra query per recipient.
- **Health and announcements:**
  - Board drop refusals read the server's English reason inside a German sentence. Op errors stay English by rule.
  - The health tooltip's English wording changed slightly ("Gone quiet: 2 of 4 systems in progress.") so it fits the parity test.
- **Bundle size:** every page receives the whole message catalogue (about 90 KB raw). This is next-intl's default, and it is fine for now.

## Things you should know
- **Collision incident.** Early on, one agent's `--amend` landed on another agent's fix commit, and one test file briefly had broken strings. I repaired it. Since then the agent rules forbid `--amend` while other agents work, and every fix goes in as a `--fixup` that I squash.
- **Encoding incident.** One agent's script stored broken umlauts ("GerÃ¤te") in three message files. It repaired them in its fix round. I checked all message files afterwards and none are affected.
- **Dev worker crash.** After the gate, I restarted the dev worker and it crashed on the `next-intl` import. I fixed it as described under Deviations. Both the dev server and the worker are running again on :3001.
- **Trailers.** Every Part 9 commit carries the Opus trailer.

## Checked automatically
- `/login` renders `lang="de"` and "Anmelden" with `Accept-Language: de`, and English otherwise.
- The dev worker starts under the `react-server` condition, with no first-tick Valkey error.

## Manual checks still to do (need sign-in)
- **Realtime:** open a board in two browsers. A change in one shows in the other within about 2 s, including rule chips. Stop Valkey and the page keeps working; start it again and updates resume.
- **Presence:** two users on one system see each other within about 2 s. Closing a tab removes the avatar quickly. An MCP tool call shows the agent avatar.
- **Language:** account menu → Language → Deutsch. Check every screen at 400 px and 1280 px for clipped labels:
  - home and sidebar
  - board with swimlanes
  - system page tabs and the mobile action bar
  - activity
  - overview
  - progress chart
  - releases
  - settings
  - notifications
  - admin
- **Time zone:** your browser's zone is picked up once per session, and timestamps shift; chart day buckets stay UTC.
- **Notifications:** with German set, mentions, answers and the test push arrive in German, and an agent's mention reads "Claude für …".
