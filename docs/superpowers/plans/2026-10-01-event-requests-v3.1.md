# Event requests v3.1 (feedback round) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the bugs from the v3 test run, strip unwanted defaults, add cancel/reopen/delete, Discord-timestamp placeholders, the reworked Störfall flow, an MCP tool for the event-day checklist, and redesign every requests page.

**Architecture:** Backend tasks (1-7) change schema, ops, worker jobs, tRPC and MCP, touching UI only where removed things would break the build. UI tasks (8-14) then rebuild the requests pages on top of the final API, using the app's existing building blocks. Task 15 updates docs and runs the final gate.

**Tech Stack:** Next 16, React 19, tRPC 11, TanStack Query 5, drizzle + Postgres (PGlite in tests), BullMQ worker, next-intl, shadcn/ui + Tailwind 4, lucide-react. **No new dependencies.**

**Spec:** `docs/superpowers/specs/2026-10-01-event-requests-v3.1-design.md` (binding; read it first, every section number below refers to it). Also read `docs/superpowers/plans/2026-10-01-roadmap-v3-event-requests.md` "Global Constraints" for the conventions this code follows.

## Global Constraints

- Ops rule: logic in `src/lib/ops/*.ts` as `(db, actor, …)`, zod inputs exported as `<name>Input`, one transaction per write, access via `requestAccess` / `eventDayAccess`, history via `logRequest`. Errors: `InvalidError`, `ForbiddenError`, `NotFoundError`, `ConflictError`.
- Web requests never call Discord; every Discord action is a job on `QUEUE.deliver`. Job ids contain no `:`.
- Migrations: change `src/db/schema/events.ts`, run `npm run db:generate -- --name <name>`, then **append** hand-written data SQL (deletes/updates/backfills) to the generated file below the generated DDL, separated by `--> statement-breakpoint` lines. Never edit older migrations.
- Discord-facing fixed text is German, in `src/lib/event-messages.ts` (`GERMAN`). UI text goes through next-intl, namespace `events`, **both** `messages/en/events.json` and `messages/de/events.json`. Literal braces in a message are ICU-quoted: `'{event}'`.
- Tests: vitest + PGlite (`createTestDb`, `requestFixture`, `postWorld`, `draftPost`, `memoryQueue`, `memoryKv`). Run the touched test files plus `npm run lint` and `npm run typecheck` before each commit.
- Commits: Conventional Commits in English, scope `events` unless stated, one commit per task, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never push.
- Every new tRPC procedure is a mutation or query on the `requests` router; `INVALIDATES.requests` already covers refetch.
- Comment and naming style: match the surrounding code (JSDoc on every export, one-line comments explaining why).
- Placeholder names (spec 4.2): `event, start, start_date, start_time, end_date, end_time, countdown, duration, where, docs, rules, note`; hidden aliases `date → start_date`, `time → start_time`.
- Limits: post text `MAX_POST_TEXT = 40_000`; disaster/resolve note 1,500; cancel note 1-1,000; summary 500; checklist item label 1-200, max 30 items per call; duration max 10,080 minutes.

## Review Focus

1. **Typing in any dialog or card never loses input on a refetch** (keys by id, no content in keys, no query keyed on typed text). Pinned in Task 13 (resolve dialog test) and Task 11 (fallback card test).
2. **A cancel message is only ever sent when the announcement has a message in Discord**, and never twice for one cancel. Pinned in Task 5.
3. **Delete never removes someone's project without them choosing it and having owner rights.** Pinned in Task 6.
4. **Placeholders render as Discord timestamps only where Discord renders them** (content, embed description); titles, footers and the Discord event get plain German text. Pinned in Task 1.
5. **Deleting a post's messages keeps its text as a new draft**, also when the delete job resumes after a crash (no second draft). Pinned in Task 4.

---

## File map (new files)

| File | Responsibility |
| --- | --- |
| `src/lib/discord-timestamp.ts` | Build `<t:N:X>` tokens and render them for in-app previews (pure) |
| `src/lib/markdown-edit.ts` | Pure text operations of the Markdown editor |
| `src/components/markdown-editor.tsx` | The shared Markdown editor |
| `src/components/events/discord-preview.tsx` | Discord-style rendering of planned message parts and embeds |
| `src/components/events/request-header.tsx` | Request page header, facts line, primary action, More menu |
| `src/components/events/lifecycle-stepper.tsx` | Status stepper incl. cancelled/withdrawn state |
| `src/components/events/request-dialogs.tsx` | Confirm dialogs: done, withdraw, start week, reopen, cancel, delete |
| `src/components/events/request-rail.tsx` | Overview rail panels |
| `src/lib/ops/request-lifecycle.ts` | `reopenRequest`, `deleteRequest`, `cancelPreview` |
| `src/lib/ops/request-lifecycle.test.ts` | Tests of the above |
| `src/lib/i18n-format.test.ts` | Formats every argument-free message of both locales |

---

### Task 1: Placeholders as Discord timestamps, thumbnails, the text cap, ICU braces

**Files:**
- Create: `src/lib/discord-timestamp.ts`, `src/lib/discord-timestamp.test.ts`, `src/lib/i18n-format.test.ts`
- Modify: `src/lib/event-placeholders.ts` (+ test), `src/lib/event-messages.ts` (+ test), `src/lib/discord-limits.ts`, `src/lib/discord-webhook.ts` (+ test), `src/lib/event-templates.ts`, `src/lib/ops/event-settings.ts` (preview uses modes), `src/lib/ops/request-posts.ts` and `src/lib/ops/request-prompts.ts` (use `MAX_POST_TEXT`), `src/components/events/post-composer.tsx` and `src/components/events/copy-prompts-dialog.tsx` (use `MAX_POST_TEXT`, chips list `VISIBLE_PLACEHOLDERS`), `messages/{en,de}/*.json` (ICU quoting), `src/db/schema/events.ts` (no column change)
- Generated: `drizzle/0039_placeholder-rename.sql` (data-only; generate with `npm run db:generate -- --name placeholder-rename --custom`)

**Interfaces (Produces):**
- `discordTimestamp(at: Date, style: "D" | "t" | "F" | "R"): string` → `<t:${Math.floor(at.getTime()/1000)}:${style}>`.
- `renderTimestamps(text: string, locale: string, timeZone: string, now?: Date): string`: replaces every `<t:(-?\d+)(?::([tTdDfFR]))?>` with the formatted value: `t` → time short, `T` → time with seconds, `d` → numeric date, `D` → long date, `f`/missing → long date + short time, `F` → weekday + long date + short time, `R` → `Intl.RelativeTimeFormat` ("in 3 days"). Pure; used by previews only.
- `PLACEHOLDERS = ["event","start","start_date","start_time","end_date","end_time","countdown","duration","where","docs","rules","note"] as const`; `type Placeholder`.
- `VISIBLE_PLACEHOLDERS: readonly Placeholder[]` = all but `note` (chips).
- `PLACEHOLDER_ALIASES: Record<string, Placeholder> = { date: "start_date", time: "start_time" }`.
- `DEFAULT_ALLOWED` = all but `note` (kept name).
- `type FillMode = "discord" | "text"`.
- `placeholderValues(request: Pick<EventRequestRow,"title"|"startsAt"|"durationMinutes"|"where"|"eventDocsUrl">, settings: { timeZone: string; rulebookUrl: string | null }, note?: string): Record<FillMode, Record<Placeholder, string>>` (the unused `_now` parameter is removed; update every caller). Text forms (German, event zone): `start` = `Samstag, 3. Oktober 2026 um 20:00 Uhr` (`dateStyle: "full"` + ` um ` + `HH:mm Uhr`), `start_date`/`end_date` = `dateStyle: "long"` (`3. Oktober 2026`), `start_time`/`end_time` = `HH:mm Uhr`, `countdown` = `""`. Discord forms: `start` `F`, `start_date` `D`, `start_time` `t`, `end_date` `D`, `end_time` `t`, `countdown` `R`; `event`, `duration`, `where`, `docs`, `rules`, `note` identical in both. End = start + duration; without a duration, end fields are empty.
- `fillPlaceholders(template, values: Record<FillMode, Partial<Record<Placeholder,string>>> | Partial<Record<Placeholder,string>>, opts?: { allow?: readonly Placeholder[]; mode?: FillMode })`: default mode `"discord"`. When `values` is the two-mode record, picks `values[mode]`. Aliases resolve before the allow check (an alias is allowed when its target is). Everything else as before (unknown stays, empty collapses spaces).
- `validateTemplate` accepts aliases as known.
- `Embed` (in `discord-limits.ts`) gains `imageAs?: "image" | "thumbnail"`. `toDiscordEmbed(embed, imageName)` puts `{ url: "attachment://<name>" }` under `thumbnail` instead of `image` when `imageAs === "thumbnail"`.
- `MAX_POST_TEXT = 40_000` exported from `src/lib/event-messages.ts`; used by `savePostDraftInput.text`, `editPostInput.text`, `savePasteBackInput.text`, and the two client components.
- Embed builders: `buildDetailsEmbed(request, settings)` — title/footer filled with mode `"text"`, description lines with `"discord"`, banner `imageAs: "thumbnail"`; description = `request.summary` (when the task 2 column exists; **in this task read `"summary" in request ? request.summary : ""`** — Task 2 makes it a real field) + `"\n\n"` + lines when the summary is non-empty. `buildDisasterEmbed`, `buildResolvedEmbed`: title text mode, description discord mode, `imageAs: "thumbnail"`, image = `settings.disasterTemplate.imageUploadId` for **both** (spec 5.2). Their `now?` parameters are removed.
- `plannedParts` fills post text in `"discord"` mode.

- [ ] **Step 1: Write failing tests**
  - `discord-timestamp.test.ts`: `discordTimestamp(new Date("2026-10-03T18:00:00Z"), "F")` → `<t:1791050400:F>`; `renderTimestamps("Start <t:1791050400:t>", "de-DE", "Europe/Berlin")` → `Start 20:00`; `R` with `now` 3 days earlier → `in 3 Tagen` (de); malformed `<t:abc:F>` stays as written.
  - `event-placeholders.test.ts`: discord mode `{start_date}` → `<t:…:D>`; text mode `{start_date}` → `3. Oktober 2026`; `{date}` → same as `{start_date}` in both modes; `{end_time}` with duration 120 from 20:00 Berlin → `22:00 Uhr` (text); without duration `{end_time}` → empty and spaces collapse; `{countdown}` text mode → empty; `validateTemplate("{date} {foo}", DEFAULT_ALLOWED)` → `["foo"]`.
  - `event-messages.test.ts`: details embed with banner has `imageAs: "thumbnail"`; a details line `Datum: {start_date}` becomes `Datum: <t:…:D>`; a footer `{start_date}` becomes the German text; disaster and resolved embeds both carry the disaster template image as thumbnail; post text `{start_time}` → `<t:…:t>`.
  - `discord-webhook.test.ts`: `toDiscordEmbed({...imageAs:"thumbnail"}, "image.png")` has `thumbnail.url === "attachment://image.png"` and no `image`.
  - `i18n-format.test.ts`: for `en` and `de`, import `messages/<locale>/index.ts`, walk every string leaf; skip leaves whose ICU text contains an argument (detect with `IntlMessageFormat` from `intl-messageformat` — already a next-intl dependency; if not importable, use `createTranslator` from `next-intl` and catch only `FORMATTING_ERROR`); for argument-free leaves `createTranslator({ locale, messages })(path)` must not throw and must not return text containing `FORMATTING_ERROR`. Simpler acceptable approach: for **every** leaf, call `t(path, PROXY)` where `PROXY` is a `Proxy` returning `"x"` for any key, and assert no throw; then separately assert the specific leaf `events.fallback.playerMessageHelp` renders literal `{start_date}` braces.
- [ ] **Step 2: Run** `npx vitest run src/lib/discord-timestamp.test.ts src/lib/event-placeholders.test.ts src/lib/event-messages.test.ts src/lib/discord-webhook.test.ts src/lib/i18n-format.test.ts` → FAIL.
- [ ] **Step 3: Implement** the interfaces above. Update every caller of `placeholderValues`/`fillPlaceholders`/builders (`event-settings.ts` `previewTemplate`, `event-prompts.ts`, worker `events-post.ts`, `request-posts.ts`). In `event-prompts.ts` keep using the **text** forms for the facts block.
- [ ] **Step 4: ICU quoting.** Search `messages/en/*.json` and `messages/de/*.json` for help texts that show placeholder names (`{event}`, `{date}`, `{time}`, `{note}`, `{duration}`, `{docs}`, `{rules}`, `{where}` inside prose that documents placeholders, e.g. `fallback.playerMessageHelp`, settings template help). Rewrite them with ICU quotes and the new names, e.g. de `"Auf Deutsch vorbereitet. Sie darf Platzhalter wie '{event}' und '{start_date}' enthalten."`. Do **not** touch real arguments such as `{name}` or `{date}` that the code passes.
- [ ] **Step 5: Migration** `0039_placeholder-rename.sql`: `UPDATE event_settings SET details_template = replace(replace(details_template::text, '{date}', '{start_date}'), '{time}', '{start_time}')::jsonb, disaster_template = …same…, resolved_template = …same…;` and `UPDATE event_post SET text = replace(replace(text, '{date}', '{start_date}'), '{time}', '{start_time}') WHERE status = 'draft';`. Update `DEFAULT_DETAILS_TEMPLATE.lines` to `["Start: {start}", "Ende: {end_time}", "Ort: {where}", "Infos: {docs}", "Regeln: {rules}"]` and add `{note}` to `DEFAULT_DISASTER_TEMPLATE.text` as spec 5.3 says.
- [ ] **Step 6: Run** the Step 2 tests plus `npx vitest run src/lib src/worker src/lib/ops/request-posts.test.ts src/lib/ops/event-settings.test.ts`, `npm run lint`, `npm run typecheck` → PASS.
- [ ] **Step 7: Commit** `feat(events): fill placeholders as discord timestamps and show images as thumbnails`.

### Task 2: Short description and prompts that write placeholders

**Files:**
- Modify: `src/db/schema/events.ts` (`summary`), `src/lib/ops/requests.ts` (`updateRequestInput.summary`, `RequestDetail`, Discord sync trigger), `src/lib/event-messages.ts` (`eventPayload`, `PayloadRequest`), `src/worker/jobs/events-discord-event.ts` (`payloadOf` passes summary), `src/lib/event-prompts.ts` (+ test), `src/lib/ops/request-prompts.ts` (+ test), `src/lib/ops/request-agent.ts` (`summary` in `RequestForAgent`), `src/test/fixtures.ts` if needed
- Generated: `drizzle/0040_event-summary.sql` via `npm run db:generate -- --name event-summary`

**Interfaces:**
- Column `event_request.summary text not null default ''`.
- `updateRequestInput.summary: z.string().trim().max(500).optional()`; a changed summary is logged (`field: "summary"`) and counts as a Discord-event field (queues the update like `title`).
- `eventPayload(request: PayloadRequest & { summary: string }, imageDataUri?)`: lead = `summary.trim()` when non-empty, else the brief's first paragraph; rest unchanged.
- `PROMPT_KINDS = ["announcement", "reminder", "team", "summary"] as const`.
- `buildPrompts(input)` returns 4 prompts. All four end with the placeholder block (below) except `summary`, which says: "Schreibe eine Kurzbeschreibung des Events auf Deutsch: ein bis zwei Sätze, höchstens 300 Zeichen, keine Platzhalter, keine Überschrift, kein Markdown. Ausgabe: nur der Text." and gets the facts and brief as context.
- Placeholder block (German, exported as `PLACEHOLDER_GUIDE`): heading `Platzhalter`, one line per visible placeholder with meaning (`{event}` Name des Events, `{start}` Beginn mit Datum und Uhrzeit, `{start_date}` Datum des Beginns, `{start_time}` Uhrzeit des Beginns, `{end_date}` Datum des Endes, `{end_time}` Uhrzeit des Endes, `{countdown}` "in 3 Tagen" bis zum Beginn, `{duration}` Dauer, `{where}` Ort, `{docs}` Link zu den Infos, `{rules}` Link zum Regelwerk), then the instruction sentence from spec 4.3. The facts block heading becomes `Zur Orientierung (nicht abschreiben)`.
- `savePasteBack(db, actor, requestId, kind, text)`: for `kind === "summary"` calls `updateRequest(db, actor, requestId, { summary: text.trim().slice(0, 500) }, queue?)` (takes an optional `queue` param, passed by the router as `bullQueue(QUEUE.deliver)`), otherwise as before. `savePasteBackInput.kind` uses the new `PROMPT_KINDS`.
- `RequestForAgent` gains `summary: string`.

- [ ] **Step 1: Failing tests**: prompts: every non-summary prompt contains `PLACEHOLDER_GUIDE` and `Zur Orientierung (nicht abschreiben)`; no prompt contains the words "Schreibe das Datum" (sanity); summary prompt contains "höchstens 300 Zeichen" and no `PLACEHOLDER_GUIDE`. Ops: `savePasteBack(…, "summary", "  Kurz.  ")` sets `summary = "Kurz."` and writes no post; `savePostDraft` and `savePasteBack("announcement", "Am {start_date}")` store `Am {start_date}` unchanged (spec 4.2). `eventPayload` with summary uses it as lead; with empty summary falls back to the brief. `updateRequest` with only `summary` on a request with `discordEventId` and a configured bot queues one `events.discord-event` update.
- [ ] **Step 2: Run** `npx vitest run src/lib/event-prompts.test.ts src/lib/ops/request-prompts.test.ts src/lib/event-messages.test.ts src/lib/ops/requests.test.ts` → FAIL.
- [ ] **Step 3: Implement**, then generate the migration. In Task 1's `buildDetailsEmbed` replace the `"summary" in request` guard by the typed field (add `"summary"` to `PlanRequest`).
- [ ] **Step 4: Run** the tests, `npm run lint`, `npm run typecheck` → PASS. The copy-prompts dialog must still compile: add the `summary` tab label key (`prompts.kind.summary`: en "Short description", de "Kurzbeschreibung") so the existing dialog shows 4 tabs.
- [ ] **Step 5: Commit** `feat(events): add a short description and let prompts write placeholders`.

### Task 3: Defaults removed, brief starts at version 0, start and end dates

**Files:**
- Modify: `src/db/schema/events.ts` (drop `eventCheckin`, drop `eventFallback.imageUploadId`, `briefVersion` default 0), `src/lib/event-prep-template.ts` (+ test), `src/lib/ops/request-setup.ts`, `src/lib/ops/requests.ts` (+ test), `src/lib/ops/request-prep.ts` (+ test; remove check-in), `src/lib/ops/request-fallback.ts` (+ test; remove image), `src/lib/ops/uploads.ts` (remove fallback reference and purpose), `src/lib/ops/request-agent.ts`, `src/lib/ops/request-prompts.ts`, `src/worker/jobs/events-discord-event.ts` (version 0), `src/server/trpc/routers/requests.ts`, `src/components/events/event-day-panel.tsx`, `src/components/events/fallback-tab.tsx`, `src/components/events/brief-history.tsx`, `src/test/fixtures.ts`
- Generated: `drizzle/0041_event-defaults.sql` via `npm run db:generate -- --name event-defaults`, then append data SQL

**Interfaces:**
- `REQUIRED_FALLBACKS = [{ key: "server-down", title: "Server dies mid-event" }] as const`. `CHECKLIST_TEMPLATE` deleted. `seedRequestDefaults(db, requestId)` inserts only the one fallback.
- `UPLOAD_PURPOSES = ["banner", "embed", "template"] as const`.
- `createRequest`: inserts brief version 1 only when `normalizeBrief(input.brief) !== ""`; then sets `briefVersion: 1` on the row, else leaves 0. `saveBriefInput.baseVersion: z.number().int().min(0)`. `getRequest`/`getBrief`/`requestForAgent`/`getPrompts`/`payloadOf`/`submitRequest` read no row when `briefVersion === 0` and use `""`. `listBriefVersions` returns `[]` then.
- `updateRequestInput.endsAt: dateSchema.nullable().optional()`; `durationSchema` max 10080. In `updateRequest`: when `endsAt` is present: `null` → `durationMinutes = null`; a date → needs a start (`input.startsAt` if given, else stored); without one → InvalidError "Set the start first."; `endsAt <= start` → InvalidError "The end must be after the start."; else `durationMinutes = Math.round((endsAt - start)/60000)`, which must be ≤ 10080 (else InvalidError "An event lasts at most 7 days."). Giving both `endsAt` and `durationMinutes` → InvalidError.
- `RequestDetail.request` gains `endsAt: Date | null` (`eventEnd`, but null without duration). `RequestListItem` gains `endsAt: Date | null`.
- Remove `listCheckins`, `checkIn`, `checkOut`, `CheckinView`, `EventDayView.checkins/checkedIn` and the router procedures `checkIn`, `checkOut`.
- `saveFallbackInput` loses `imageUploadId`.

Migration data SQL to append (in order):
1. `DELETE FROM event_fallback WHERE key IN ('staff-missing','too-few-players') AND btrim(what_we_do) = '' AND btrim(who_decides) = '' AND player_message IS NULL;`
2. `UPDATE event_fallback SET required = false WHERE key IN ('staff-missing','too-few-players');`
3. `DELETE FROM event_checklist_item WHERE key IS NOT NULL AND done_at IS NULL;`
4. `UPDATE event_request r SET brief_version = 0 WHERE brief_version = 1 AND EXISTS (SELECT 1 FROM event_brief_version v WHERE v.request_id = r.id AND v.version = 1 AND btrim(v.body) = '');` then `DELETE FROM event_brief_version v USING event_request r WHERE v.request_id = r.id AND r.brief_version = 0;`
5. `DELETE FROM event_upload WHERE purpose = 'fallback';` (the generated DDL, which runs first, drops `event_checkin` and `event_fallback.image_upload_id`; the order does not matter because the FK was `on delete set null`).

- [ ] **Step 1: Failing tests**: `createRequest` with `brief: ""` → `briefVersion 0`, no brief rows, `getRequest().brief === ""`; `saveBrief` with `baseVersion: 0` → version 1; `createRequest` with a brief → version 1 as before; a new request has exactly one fallback (`server-down`, required) and zero checklist items; `startEventWeek` is refused only while `server-down` is incomplete; `updateRequest({ endsAt })` sets duration, refuses end before start, end without start, both fields, > 7 days; `getRequest().request.endsAt` is start + duration.
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/requests.test.ts src/lib/ops/request-prep.test.ts src/lib/ops/request-fallback.test.ts src/lib/event-prep-template.test.ts` → FAIL.
- [ ] **Step 3: Implement**; delete check-in tests and code; fix `requestFixture` (it calls `seedRequestDefaults`, still fine) and every test that counted 3 fallbacks or 4 checklist items (search `staff-missing`, `too-few-players`, `server-checked`, `checkIn`).
- [ ] **Step 4: Minimal UI so it builds**: `event-day-panel.tsx` drops the check-in panel and the `TEMPLATE_KEYS` translation (render `item.label`); `fallback-tab.tsx` drops the `ImageUpload` and the image key part (key `s.id`); `brief-history.tsx` shows the empty text for version 0; the details form keeps working (the UI for start/end comes in Task 10). Remove i18n keys `eventDay.items.*`, `eventDay.checkins`, `checkIn`, `checkOut`, `checkedInAt`, `nobody` in both locales.
- [ ] **Step 5: Generate** the migration and append the data SQL; run `npx vitest run src/lib src/worker src/server`, `npm run lint`, `npm run typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(events): drop default scenarios, checklist and check-in, start the brief empty`.

### Task 4: Störfall notes, resolve as its own message, deletes keep the text

**Files:**
- Modify: `src/lib/ops/request-posts.ts` (+ test), `src/worker/jobs/events-post.ts` (+ test), `src/server/trpc/routers/requests.ts`, `src/lib/event-messages.ts` (+ test), `src/components/events/disaster-panel.tsx` (minimal), `src/lib/ops/requests.test.ts` (markDone test)

**Interfaces:**
- `postDisasterInput = z.strictObject({ note: z.string().max(1500).optional() })`; `postDisaster(db, actor, requestId, raw: unknown, queue)` stores `note: note?.trim() || null` on the disaster post and plans with it.
- `buildDisasterEmbed(request, settings, note: string | null)`: fills `{note}` (allow all placeholders); when the template text has no `{note}` and `note` is non-empty, appends `"\n\n" + note`.
- `plannedParts` for `kind === "disaster"` passes `post.note`.
- `resolveDisasterInput = z.strictObject({ note: z.string().max(1500).optional() })`. `resolveDisaster(db, actor, requestId, raw, queue)`: in one transaction: find the live disaster post that is `posted` with `resolvedAt === null` (else Conflict); set its `resolvedAt = now`; insert a post `{ kind: "resolved", note: note?.trim() || null, status: "sending", attempt: 1, parts: plan(...), postedBy, createdBy }`; log `resolved sending`; return `sendJob(newId, 1)`. The disaster post's parts are not touched.
- `DisasterView` becomes `{ canAct; hookSet; post (disaster, as before minus resolving); resolved: { id, status, lastError, partsCount, sentCount, stale } | null (newest resolved post created after the disaster post); template: { disaster: EmbedTemplate; resolved: EmbedTemplate; imageUploadId: string | null }; request: PlanRequest; timeZone: string; rulebookUrl: string | null }` so the client fills previews itself with `buildDisasterEmbed`/`buildResolvedEmbed`. `disasterView(db, actor, requestId)` takes no note. Router `disasterState` input drops `note`.
- Remove `runResolve`, `resolveDisasterMessage`, the `events.resolve` registration, `GERMAN.backOnline`, the resolve branch in `resumePost`, and `Queued.name`'s `"events.resolve"`.
- `resumePost`, `deletePost` accept kind `resolved`.
- Delete keeps text (spec 1.5): in `runDelete`'s final transaction, after marking `deleted`, when `run.post.kind` is `team`, `announcement` or `reminder`, insert `{ id: newId(), requestId, kind, status: "draft", text, embed, pingRole, createdBy: run.post.createdBy }` **only if** no other live post of that kind exists (guard with a select inside the transaction; the unique index `event_post_one_live_per_kind` also protects it). Log `${kind} kept as draft`.

- [ ] **Step 1: Failing tests**: ops: `postDisaster` with a note stores it and the planned embed description contains the note; `resolveDisaster` creates a `resolved` post with `status: "sending"`, sets the disaster `resolvedAt`, leaves the disaster `parts` deep-equal to before, queues exactly one `events.post` job; a second resolve → Conflict; `disasterView` has no `note` param and returns `template`. Worker: after a successful `events.delete` of an announcement, one live `draft` announcement exists with the same `text` and `pingRole`; running the same delete job again (replay) creates no second draft; deleting a disaster creates no draft. `markDone` leaves every `event_post` row deep-equal (spec 1.6).
- [ ] **Step 2: Run** `npx vitest run src/lib/ops/request-posts.test.ts src/worker/jobs/events-post.test.ts src/lib/event-messages.test.ts src/lib/ops/requests.test.ts` → FAIL.
- [ ] **Step 3: Implement**; delete the obsolete resolve tests and rewrite the ones that asserted the patch-in-place behavior.
- [ ] **Step 4: Minimal UI so it builds**: `disaster-panel.tsx` calls `disasterState` without note and builds the preview embeds on the client with the builders (import from `@/lib/event-messages`; make sure that module has no server-only imports — move nothing server-only into it), uses `placeholderData: keepPreviousData`, and never returns `null` after the first load (render a skeleton line while `view` is undefined). Post dialog: a plain `Textarea` note for now (Task 13 swaps in the Markdown editor).
- [ ] **Step 5: Run** the tests, `npm run lint`, `npm run typecheck` → PASS.
- [ ] **Step 6: Commit** `feat(events): post disaster notes, resolve as a new message and keep text after deletes`.

### Task 5: Cancel with a Discord message, reopen

**Files:**
- Create: `src/lib/ops/request-lifecycle.ts`, `src/lib/ops/request-lifecycle.test.ts`
- Modify: `src/lib/event-status.ts` (+ test), `src/db/schema/events.ts` (`cancelNote`, `cancelledTemplate`), `src/lib/event-templates.ts`, `src/lib/event-messages.ts` (`POST_KINDS`, `POST_TARGET`, `buildCancelledEmbed`, `plannedParts`), `src/lib/ops/requests.ts` (`cancelRequest`), `src/lib/ops/event-settings.ts` (+ test; template, preview kind `cancelled`, `PostSettings`), `src/lib/ops/request-posts.ts` (listPosts includes cancelled/resolved/disaster for the timeline; `canPostKind`), `src/worker/jobs/events-post.ts` (`requestAllows` lets a `cancelled` post send for a `cancelled` request), `src/worker/jobs/events-discord-event.ts` (+ test; action `create`), `src/server/trpc/routers/requests.ts`
- Generated: `drizzle/0042_event-cancel.sql` via `npm run db:generate -- --name event-cancel`

**Interfaces:**
- `EDGES`: add `cancelled: ["accepted"]`, `withdrawn: ["draft"]`.
- Columns: `event_request.cancel_note text` (nullable); `event_settings.cancelled_template jsonb not null default DEFAULT_CANCELLED_TEMPLATE`.
- `DEFAULT_CANCELLED_TEMPLATE: EmbedTemplate = { title: "Event abgesagt", text: "{event} am {start_date} findet leider nicht statt.\n\n{note}", color: "#8a8f98", imageUploadId: null }`.
- `POST_KINDS = ["team","announcement","reminder","disaster","resolved","cancelled"]`; `POST_TARGET.cancelled = "public"`.
- `buildCancelledEmbed(request, settings, note)`: title text mode, description discord mode with `{note}`, `imageUploadId: request.bannerUploadId`, `imageAs: "thumbnail"`.
- `PostSettings` and `PlanSettings` include `cancelledTemplate`. `updateEventSettingsInput.cancelledTemplate: embedTemplateSchema.optional()`; `previewTemplateInput` gains kind `cancelled`.
- `announcementInDiscord(tx, requestId): Promise<boolean>` (in `request-posts.ts`): the live announcement post has a part with a `messageId`.
- `cancelPreview(db, actor, requestId): Promise<{ willPost: boolean; reason: "posted" | "not-posted" | "no-webhook"; embed: Embed | null }>` (in `request-lifecycle.ts`): `willPost` when `announcementInDiscord` and the public hook is set; `embed` is the cancelled embed with `{note}` left as the literal `{note}` for the client to fill.
- `cancelRequest(db, actor, requestId, raw: unknown, queue?)`: `raw = { reason: string }` via `cancelRequestInput = z.object({ reason: z.string().trim().min(1).max(1000) })` (**signature change**: the router passes `{ reason }`). In the transaction: move to `cancelled`, set `cancelNote = reason`, log; when `announcementInDiscord` and the public hook is set, insert a `cancelled` post (`note = reason`, `status: "sending"`, `attempt: 1`, planned parts) and remember its job. After commit: enqueue the post job (if any) and the Discord-event delete (exists).
- `reopenRequest(db, actor, requestId, queue?)` in `request-lifecycle.ts`: `cancelled → accepted` with manage-or-develop access (reuse the access helper used by cancel; export `manageOrDevelop` from `requests.ts`), clears `cancelNote`; `withdrawn → draft` with edit access (`editAccess`, export it too). Logs the status change. After commit, when the new status is `accepted`, the announcement is in Discord and `botConfigured`, enqueue `events.discord-event` `{ requestId, action: "create" }` with job id `event-dev-<id>-create-<updatedAt ms>`.
- `syncDiscordEvent` action enum gains `"create"`: loads request, settings and secrets, calls `ensureDiscordEvent(deps, request, settings, secrets)`; a `DiscordEventRetry` re-queues like the update path.
- `RequestDetail` gains `cancelNote: string | null`, `canReopen: boolean` (status cancelled and manage-or-develop, or withdrawn and edit), `canDelete: boolean` (filled in Task 6; set `false` here).
- Router: `cancel` input `{ id, reason }` (unchanged shape), `reopen: { id }`, `cancelPreview: { id }` (query).

- [ ] **Step 1: Failing tests** (`request-lifecycle.test.ts`, `requests.test.ts`, `events-discord-event.test.ts`, `event-status.test.ts`): `canTransition("cancelled","accepted")` true, `("withdrawn","draft")` true, `("done", anything)` false. Cancel with a posted announcement and public hook → one `cancelled` post with `note` = reason and one `events.post` job, plus the Discord-event delete job when an event exists; cancel without a posted announcement → no cancelled post; cancel with a posted announcement but no public hook → cancelled, no post; `cancelPreview` reasons for all three; reason over 1000 → Invalid; reopen cancelled → `accepted`, `cancelNote` null, queues `create` when announcement posted and bot configured, queues nothing otherwise; reopen by a requester (no manage/develop) → Forbidden; reopen withdrawn → draft; reopen of a `done` request → Conflict. Worker: an `events.post` job for a `cancelled` post on a `cancelled` request sends; a `team` post on a `cancelled` request does not. Discord event `create` action calls `createScheduledEvent` once and stores the id.
- [ ] **Step 2: Run** them → FAIL.
- [ ] **Step 3: Implement**; generate the migration.
- [ ] **Step 4: Minimal UI so it builds**: the existing `CancelDialog` sends `{ id, reason }` and allows 1000 characters.
- [ ] **Step 5: Run** tests, lint, typecheck → PASS.
- [ ] **Step 6: Commit** `feat(events): announce cancels in discord and reopen cancelled events`.

### Task 6: Delete requests, with the choice what happens to a created project

**Files:**
- Modify: `src/lib/ops/request-lifecycle.ts` (+ test), `src/db/schema/events.ts` (`projectCreated`), `src/lib/ops/request-link.ts` (set `projectCreated` on create mode), `src/lib/ops/requests.ts` (`RequestDetail.canDelete`, `projectCreated`), `src/lib/ops/uploads.ts` (export a helper to remove files), `src/worker/jobs/events-discord-event.ts` (`delete-orphan` action), `src/server/trpc/routers/requests.ts`
- Generated: `drizzle/0043_event-delete.sql` via `npm run db:generate -- --name event-delete`, plus backfill SQL

**Interfaces:**
- Column `event_request.project_created boolean not null default false`. Backfill: `UPDATE event_request r SET project_created = true FROM project p WHERE p.id = r.project_id AND r.accepted_at IS NOT NULL AND p.created_at BETWEEN r.accepted_at - interval '5 seconds' AND r.accepted_at + interval '60 seconds';`
- `deleteRequestInput = z.object({ project: z.enum(["keep", "archive", "delete"]).default("keep") })`.
- `deleteChoices(db, actor, requestId): Promise<{ allowed: boolean; reason: string | null; project: { slug: string; name: string; created: boolean; canArchive: boolean; canDelete: boolean; archived: boolean } | null }>` — for the dialog. `canArchive`/`canDelete` = the actor is owner of the project or admin (use `projectAccess(tx, actor, slug, "owner", { allowArchived: true })` in a try/catch).
- `deleteRequest(db, actor, requestId, raw: unknown, queue?, dir = uploadsDir())`:
  - Access: managers/admins (`requestAccess(…, "manage")`), or the requester for their own `draft`/`withdrawn` request (`edit` access + status check).
  - Status must be `draft`, `submitted`, `withdrawn` or `cancelled`, else Conflict "Only drafts, submitted, withdrawn and cancelled events can be deleted."
  - `project !== "keep"` requires `projectCreated` and a project; else Invalid "Only a project created from this event can be archived or deleted here.". Rights checked **before** anything is deleted (Forbidden).
  - Transaction: collect upload `storageKey`s of the request; when `discordEventId` is set and the bot is configured, remember `{ guildId, eventId }`; delete the request row.
  - After commit: when the project choice is `archive` → `archiveProject(db, actor, slug)`; `delete` → `deleteProject(db, actor, slug)`; remove the upload files (best effort, `fs.rm` with `force`, via a new `removeUploadFiles(keys: string[], dir)` in `uploads.ts`); enqueue `events.discord-event` `{ requestId, action: "delete-orphan", guildId, eventId }` (job data schema extended; this action deletes the event by ids without reading the request).
- `RequestDetail.canDelete` = the same rule as the access+status check; `RequestDetail.request.projectCreated` comes with the row.
- Router: `deleteChoices: { id }` query, `delete: { id, project }` mutation.

- [ ] **Step 1: Failing tests**: manager deletes a cancelled request → row gone, uploads rows gone and files gone from the temp dir; accepted/event_week/done → Conflict; requester deletes own draft → ok, own submitted → Forbidden; stranger → NotFound; `project: "delete"` on a created project by its owner → project gone; by a manager who is not owner → Forbidden and **the request still exists**; `project: "archive"` → project archived; `project: "delete"` on a linked (not created) project → Invalid; request with a Discord event and bot → one `delete-orphan` job with the ids; accept in create mode sets `projectCreated`, link mode does not; `deleteChoices` reports rights correctly.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, generate the migration, append the backfill. **Step 4: Run** tests, lint, typecheck → PASS.
- [ ] **Step 5: Commit** `feat(events): delete events and choose what happens to their project`.

### Task 7: `set_event_checklist` over MCP and richer `get_request`

**Files:**
- Modify: `src/lib/ops/request-prep.ts` (+ test), `src/lib/ops/request-agent.ts` (+ test), `src/lib/tools/definitions.ts`, `src/lib/tools/registry.test.ts`, `src/lib/mcp/tool-list.ts`, `src/server/trpc/router.test.ts` if it lists tools, `plugin/skills/event-requests/SKILL.md`, `plugin/commands/requests.md`, `plugin/.claude-plugin/plugin.json`, `plugin/README.md`, plugin tests under `plugin/**/*.test.mjs` if they snapshot commands

**Interfaces:**
- `setEventChecklistInput = z.object({ items: z.array(z.object({ label: z.string().trim().min(1).max(200) })).max(30) })`.
- `setEventChecklist(db, actor, requestId, raw): Promise<ChecklistItemRow[]>`: access = `edit`, else `develop` (same try/catch pattern as `startEventWeek`); status `done`/`withdrawn`/`cancelled` → Conflict; delete unticked items; insert new ones with `sortOrder` after the max ticked `sortOrder`; `key: null`; log `{ field: "checklist", newValue: "<n> items" }` (pass `actor.agent` through `logRequest` as the existing tools do); returns the full list ordered.
- Checklist rows gain no column. **R:** the spec's "from the plan" flag is dropped; agent-written items look like any other item.
- Tool: `defineTool({ name: "set_event_checklist", description: "Replace the open items of an event's event-day checklist with these checks (ticked items stay).", input: { request: z.string().min(1).max(64), ...setEventChecklistInput.shape }, write: true, method: "PUT", path: "/requests/:request/checklist", run: … })`.
- `RequestForAgent` gains `endsAt: string | null` (ISO), `checklist: { label: string; done: boolean }[]`, and keeps `summary` from Task 2.
- Budget: measure `toolListBytes()` after adding the tool; set `TOOL_LIST_BUDGET_BYTES` to that value + 200, commit body explains "set_event_checklist added; +200 bytes headroom".
- Plugin: SKILL section "Event-day checklist" (5-12 checks, concrete, owner and time relative to start, from plan + fallback, then `set_event_checklist`); command `requests.md` documents `event-day <request-id>`; `plugin.json` version patch bump; README line.

- [ ] **Step 1: Failing tests**: replace semantics (2 ticked + 3 open, set 2 new → 2 ticked first then the 2 new, old open gone); 31 items → Invalid; a developer of a submitted request can set it; a stranger → NotFound; a cancelled request → Conflict; `requestForAgent` returns `checklist`, `endsAt`, `summary`; registry test lists `set_event_checklist`; tool-list budget test passes with the new constant.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**. **Step 4: Run** tests, `npm run test:plugin`, lint, typecheck → PASS.
- [ ] **Step 5: Commit** `feat(events): let the agent write the event-day checklist` (body: budget reason).

---

## UI tasks

Every UI task: **load the `frontend-design:frontend-design` skill first** and follow spec section 8. Study these before writing UI: `src/components/page.tsx` (`Page`, `PageHeader`, `Panel`, `EmptyState`), `src/app/(app)/p/[project]/systems/[system]/system-view.tsx` and `src/components/system/rail.tsx` (header facts line, rail panels), `src/app/(app)/p/[project]/settings/settings-frame.tsx` + `src/components/settings/settings-nav.tsx` (sub-navigation), `src/components/ui/*` (use `AlertDialog`, `DropdownMenu`, `Tooltip`, `Sheet`, `Badge`, `Checkbox`, `Switch`, `NativeSelect`), and `src/app/globals.css` for tokens (`bg-card`, `text-fg-2`, `bg-brand-soft`, `text-brand-strong`, `cat-*`, `bg-danger-soft`, `font-display`). Use only these tokens and components; no raw hex colours, no new ad-hoc bordered `<p>` banners. Every control has an accessible name; layout works at 375px wide. Each UI task adds tests with `@testing-library/react` for the behaviour it lists (the repo already has component tests, e.g. `src/components/overview/attention-list.test.tsx`; copy its render/provider setup). Keep every string in `messages/{en,de}/events.json`; remove keys that become unused. Run `npm run lint`, `npm run typecheck`, the new tests, then commit with scope `events`.

### Task 8: Markdown editor and Discord preview

**Files:** Create `src/lib/markdown-edit.ts` (+ test), `src/components/markdown-editor.tsx` (+ test), `src/components/events/discord-preview.tsx` (+ test). Modify `src/components/pages/page-editor.tsx` (use the editor), `messages/{en,de}/common.json` (new `markdownEditor.*` keys).

**Interfaces:**
- `markdown-edit.ts` (pure, each takes `{ value, start, end }` and returns `{ value, start, end }`): `wrapSelection(state, before, after, placeholder)`, `toggleLinePrefix(state, prefix)` (`"# "`, `"> "`, `"- "`, `"1. "`, `"- [ ] "`), `insertLink(state)` (`[text](https://)` with `https://` selected), `insertBlock(state, block)` (code block, `---`), `continueList(state)` → state or `null` when not in a list (Enter handling: continues `- `, `* `, `1. ` → `2. `, `- [ ] `/`- [x] ` → `- [ ] `; on an empty item removes the marker and returns the line empty), `indentLines(state, outdent: boolean)`.
- `MarkdownEditor` props per spec 2.2: `{ value: string; onChange(value: string): void; id?: string; "aria-label"?: string; maxLength?: number; minRows?: number; placeholder?: string; disabled?: boolean; variant?: "full" | "compact"; extraTools?: ReactNode; footer?: ReactNode }`. Mode state `"write" | "preview" | "split"`; default `"split"` when `variant === "full"` and `matchMedia("(min-width: 1024px)")` matches, else `"write"`. Toolbar buttons are `Button size="icon-sm" variant="ghost"` with `Tooltip` labels and `aria-label`, grouped with `Separator`. Shortcuts per spec. Textarea autosizes (`field-sizing: content` class `field-sizing-content` if Tailwind 4 supports it, else a resize effect) between `minRows` (default 8 full / 4 compact) and 70vh. Counter `n / max` bottom-right when `maxLength` is set. Undo works because edits go through `document.execCommand("insertText")` when available, falling back to setting the value (keep the caret with `setSelectionRange` after render).
- `DiscordPreview` props: `{ parts: { kind: "text" | "embed" | "event-link"; content: string; embed?: Embed }[]; postAs: string; locale: string; timeZone: string }`. Renders a Discord-like message group: avatar circle, `postAs` name, then each part: text through `renderTimestamps` + `Markdown`; an embed as a card with a 4px left colour bar, title (link when `url`), description (timestamps + Markdown), thumbnail top-right or image below (`/api/uploads/<id>`), footer; an event-link part as a compact "Discord event" card with the URL. Role mentions `<@&id>` render as a pill `@Event`. Uses theme tokens (works in light and dark).

- [ ] **Step 1: Failing tests**: `markdown-edit` — wrap bold around "abc" selected; toggle `# ` on/off; continue `1. x` → `\n2. `; Enter on `- ` alone ends the list; indent two lines adds two spaces each. Editor — typing calls `onChange`; Ctrl+B wraps the selection; Preview button shows rendered heading; counter shows. Preview — `<t:1791050400:t>` renders `20:00` for `de-DE`/`Europe/Berlin`; thumbnail embed renders an `img` with the upload URL; mention renders `@`.
- [ ] **Step 2: Implement**; switch `page-editor.tsx` to `MarkdownEditor` (keep its save/conflict logic). **Step 3: Run** tests, lint, typecheck → PASS. **Step 4: Commit** `feat(events): add a markdown editor and a discord-style preview` (scope `ui` is fine too; use `events`).

### Task 9: Requests list redesign

**Files:** Modify `src/app/(app)/(global)/requests/requests-view.tsx` (split into `src/components/events/request-list.tsx` + small row component if it passes ~250 lines), `src/lib/ops/requests.ts` (`RequestListItem` gains `endsAt`, `requesterId`, `acceptedBy`, `submittedAt`; `needsActor: boolean` computed per spec 8.2: requester with open questions, developer flag and status `submitted`, or the actor owns a late to-do), messages.
- Layout per spec 8.2. Sections are `Panel`s with a count in `meta`. "Past" uses `Collapsible`, closed by default. Row: date block (weekday short, day number, month short; muted "No date" block without start), title link, status `Badge` (colour per status: draft muted, submitted brand, accepted `cat-planning` or brand, event_week `cat-active`/warning, done `cat-done`, cancelled destructive outline, withdrawn muted), "20:00-22:00" (or date range when multi-day), `PersonAvatar` + name (`src/components/person-avatar.tsx`), project chip linking `/p/<slug>`, attention badges (questions waiting, late to-dos). Toolbar: search input (client-side title filter), status filter chips (reuse `src/components/filter-chip.tsx` if it fits), "Mine" toggle (requester is me or accepted by me). New request dialog: title + optional start/end; creates the draft without brief.
- Tests: rows land in the right sections; search filters; Past is collapsed; empty state when nothing exists.
- Commit `feat(events): redesign the requests list`.

### Task 10: Request page shell, lifecycle actions and Overview

**Files:** Create `request-header.tsx`, `lifecycle-stepper.tsx`, `request-dialogs.tsx`, `request-rail.tsx` in `src/components/events/`; rewrite `src/app/(app)/(global)/requests/[request]/request-view.tsx` (shell + Overview only; tabs render the components of Tasks 11-13), modify `src/app/(app)/(global)/requests/[request]/page.tsx` (default tab `overview`), `src/components/events/status-bar.tsx` (delete if replaced), `src/components/events/accept-dialog.tsx` (use start-end display), messages.
- Header per spec 8.3: `PageHeader` crumbs `Requests / <title>`, title, facts line (status badge, start-end with weekday, where, requester avatar, project link), actions: the **primary** next step (Submit / Accept / Start event week / Complete event / Reopen) and a `DropdownMenu` "More" with: Copy prompts, Recall, Withdraw, Cancel event, Reopen (if not primary), Delete, Open event-day page, Event settings. Items the actor cannot use are hidden; items blocked by state are disabled with a tooltip reason (e.g. Start event week while the fallback is incomplete).
- `LifecycleStepper`: five steps with done/current/upcoming states; for `cancelled`/`withdrawn` a danger/muted strip with the status, who/when (from history), the cancel note rendered as Markdown, and the Reopen button when `canReopen`.
- Dialogs (`AlertDialog` for plain confirms): Complete event, Withdraw, Start event week, Reopen. **Cancel**: compact `MarkdownEditor` for the reason (required, max 1000), and `cancelPreview` result: when `willPost` the filled `DiscordPreview` of the cancelled embed (fill `{note}` client side) with the line "This message is posted to the public channel."; `not-posted` → "No cancel message is sent, because the announcement was not posted."; `no-webhook` → warning. **Delete**: reads `deleteChoices`; when a created project exists, a radio group Keep / Archive / Delete project with disabled options + reasons; type-the-title confirmation is **not** required (R: one explicit dialog is enough); on success navigate to `/requests`.
- Overview tab per spec 8.3: main column = Summary card (summary text, edit inline with counter 500, Save/Discard), Details card (title, Start, End (`datetime-local` in the event zone; send `startsAt`/`endsAt`), Where, Docs link) with per-card dirty state, Banner card (`ImageUpload`). Rail (`request-rail.tsx`): Needs attention (open questions → link to Questions tab, fallback incomplete → Fallback tab, late to-dos → Prep tab, Discord event missing docs link / bot problem), Discord (event link or reason, announcement/reminder/team statuses as small badges linking to Messages), Build progress (`EventProgressBar`), Next to-dos (3 soonest open), History (last 5 sentences; "Show all" opens a `Sheet` with the full `HistoryList`).
- Every card keys by request id only and keeps its draft state across refetches (initialize from server once; after a successful save, adopt the saved values).
- Tests: primary action per status (draft→Submit for the requester; submitted→Accept for a developer; accepted→Start event week; event_week→Complete; cancelled→Reopen); Complete opens a confirm dialog and only mutates after confirm; cancel dialog disables confirm with an empty reason and shows the not-posted line; details form sends `endsAt`; a refetch with a new `updatedAt` does not reset a dirty Details card.
- Commit `feat(events): redesign the request page header, lifecycle and overview`.

### Task 11: Brief, Questions, Fallback and Prep tabs

**Files:** Modify `request-view.tsx` (Brief tab), `src/components/events/brief-history.tsx`, `src/components/events/question-form.tsx`, `src/components/events/fallback-tab.tsx`, `src/components/events/prep-tab.tsx`, messages.
- Brief: two columns on `lg` (editor | versions rail); the `MarkdownEditor` variant full; Save as version N+1 button with dirty state; conflict banner as an inline `role="alert"` row inside the editor footer with Reload; read-only render when not editable. Version 0 shows an `EmptyState` "No brief yet".
- Questions: restyle rounds as `Panel`s with the question cards; keep behaviour.
- Fallback: one card per scenario, key `s.id` (spec 1.2); "What we do" uses compact `MarkdownEditor`; who decides; player message textarea with the placeholder help; Save/Discard per card; required badge; "Add scenario" as a dashed ghost card with an inline title field.
- Prep: group to-dos into Late, This week, Later, Done (collapsed); row with checkbox, title, owner avatar, due date (relative + absolute tooltip), edit/remove for custom ones; add form at the bottom.
- Tests: fallback card keeps typed text after a refetch that changes another scenario; saving one card does not reset another card's unsaved text; prep grouping by due date.
- Commit `feat(events): redesign the brief, questions, fallback and prep tabs`.

### Task 12: Messages tab

**Files:** Modify `src/components/events/post-composer.tsx` (split: `post-card.tsx` for the editable card, `post-entry.tsx` for read-only disaster/resolved/cancelled entries), `src/components/events/copy-prompts-dialog.tsx` (4th tab "Short description"; paste-back of summary says it saves the short description), `src/lib/ops/request-posts.ts` (`previewPost` returns `{ parts: PreviewPart[]; embeds }` with the embed objects so the client can render `DiscordPreview`; `PreviewPart` gains `embed?: Embed`), messages.
- Layout: a vertical timeline in due order (team −8 d, announcement −7 d, reminder −1 d) with the due date on the rail of the timeline; after them, Störfall/resolved/cancelled entries in time order (read-only, status, Resume/Delete where allowed).
- Post card: `MarkdownEditor` (full) with `extraTools` = placeholder chips (`VISIBLE_PLACEHOLDERS`, inserted at the caret), ping `Switch` (announcement/reminder), one dirty hint line ("Save your changes first.") shown **once** above the button row when dirty (spec 1.4), buttons: Save, Post now (confirm `AlertDialog` showing ping/no ping), Resume, Edit, Delete messages (confirm text from spec 1.5), Test send. Preview side: `DiscordPreview` of the saved post (from `previewPost`), with "Preview shows the saved text" when dirty.
- Card key: `kind + post.id` only (no status/text in the key); local state adopts server text when the server's `updatedAt` changes **and** the card is not dirty.
- Tests: the dirty hint appears exactly once; deleting shows the confirm with the "text stays" sentence; card does not lose typing when the list refetches; placeholder chip inserts at the caret.
- Commit `feat(events): redesign the messages tab with discord previews`.

### Task 13: Event day and Störfall

**Files:** Modify `src/components/events/event-day-panel.tsx`, `src/components/events/disaster-panel.tsx`, `src/app/(app)/(global)/requests/[request]/event-day/page.tsx`, messages.
- Event header card: title, start-end, where, countdown (relative, updates every minute), status.
- Checklist panel: items with checkbox, done-by/time, remove for list managers; add item inline; empty state "No checks yet. The developer's agent writes them from the plan with `/surf-roadmap:requests event-day <id>`, or add them here."
- Fallback scenarios: always visible cards (Markdown "what we do", who decides, player message with a Copy button).
- Störfall panel: Post (dialog with compact `MarkdownEditor` note, max 1500, live `DiscordPreview` built client-side), the posted disaster with status and Delete, Resolve (dialog with note editor and live preview; the panel never unmounts while typing), the resolved post with status/Resume/Delete. "Never pings" hint once.
- The standalone page uses `Page width="medium"` with the same panel and a back link to the request.
- Tests: typing 20 characters into the resolve note keeps the dialog open and the text intact (spec 1.3; mock the query to refetch between keystrokes); post dialog preview shows the note.
- Commit `feat(events): redesign the event day and the störfall panel`.

### Task 14: Event settings page

**Files:** Modify `src/app/(app)/(global)/requests/settings/event-settings-view.tsx` (split into section components under `src/components/events/settings/`), `src/components/events/embed-template-editor.tsx`, `src/components/events/secret-field.tsx`, messages.
- Layout per spec 8.4 with a left section nav (`SettingsNav`-like list of anchors; active section highlighted on scroll or via `?section=`), sections: Posting, Webhooks and bot (admin; secrets masked as now), Writing style, Templates: Details, Störfall (with the one Störfall image upload, shown as thumbnail in previews), Resolved (no image field), Cancelled. Each template editor has a live `DiscordPreview` beside it (stacked on mobile) using sample data from `previewTemplate`. Placeholder help lists the visible placeholders with meaning (ICU-quoted).
- Each section saves on its own with dirty state.
- Tests: the resolved editor has no image control; the Störfall image upload is present for managers; preview updates when typing the title.
- Commit `feat(events): redesign the event settings page`.

### Task 15: Docs, report and final gate

**Files:** `docs/event-requests.md`, `README.md` (if it mentions check-in or placeholders), `docs/superpowers/reports/v3.1-report.md`.
- [ ] Update the user guide per spec 9: statuses and transitions (reopen, delete), placeholders table (new names, Discord timestamp note, aliases), cancel message and template, Störfall notes and separate resolve message, the generic Störfall image, the short description and its prompt, start/end, removed check-in and default checklist, `set_event_checklist` and `/surf-roadmap:requests event-day`, permissions table rows for Reopen and Delete.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:plugin`, `npm run build`, `npm run check:worker-imports`. All must pass.
- [ ] Commit `docs(events): document the v3.1 changes`.
- The report is written by the controller after the final review.

---

## Self-review notes

- Spec coverage: 1.1 → T1; 1.2 → T3/T11; 1.3 → T4/T13; 1.4 → T12; 1.5 → T4; 1.6 → T4; 2.1 → T3; 2.2 → T8 (+ uses in T10-T13); 3.x → T3; 4.1 → T3/T10; 4.2 → T1; 4.3 → T2; 4.4 → T2/T10/T12; 4.5 → T1; 4.6 → T1; 5.1 → T3; 5.2 → T1/T14; 5.3-5.5 → T4/T13; 6 → T7/T13; 7.1-7.3 → T5/T10; 7.4 → T6/T10; 7.5 → T10; 8 → T8-T14; 9 → T15.
- Deviation from the spec, recorded as a ruling: the "from the plan" flag on checklist items (spec 8.3) is dropped (no column), see Task 7.
