# Event requests v3.1: feedback round

Branch `feat/v3.1` (off `main` after v3 was fast-forwarded into it). Source: the user's test run of v3 on 2026-10-01. The user
went to work after asking and said "no more questions", so every open point below is a ruling, marked **R**. The final report
lists them again.

## Goals

1. Fix the bugs the user hit (ICU crash, lost text, flickering dialog, doubled hint, wiped messages).
2. Strip defaults the user does not want (empty brief v1, two of three fallback scenarios, the checklist template, check-in, scenario images).
3. Make cancelled events reopenable, deletable, and announce a cancel in Discord.
4. Move placeholders to Discord timestamps and make the copy prompts write placeholders.
5. Rework the Störfall flow (notes, thumbnail, resolve as its own message).
6. Let the developer's agent write the event-day checklist over MCP.
7. Redesign every requests page so it looks like the rest of the app.

Out of scope: the 403 when creating the Discord event. The dev DB shows `bot_status = missing-permissions` (Discord code 50013): the
bot lacks Manage Events / Create Events on guild 449314616628084758. The user said this is their own setup and to ignore it.

---

## 1. Bugs

### 1.1 ICU crash on the Fallback tab
`messages/de/events.json` `fallback.playerMessageHelp` contains `{event}` and `{time}` literally; next-intl parses them as arguments
and throws `FORMATTING_ERROR`. Escape literal braces with ICU quoting (`'{event}'`) in **every** message of `messages/{de,en}/*.json`
that shows a placeholder name to the user. Add a unit test that loads both locales' `events` namespace and formats every message whose
ICU AST has no arguments of its own with `createTranslator` and no values; it must not throw. (The `playerMessageHelp` key itself
changes text in 4.2 because placeholders are renamed.)

### 1.2 Scenario text lost on image upload
Cause: `ScenarioCard`'s React key is `${id}-${whatWeDo}-${whoDecides}-${imageUploadId}`, so a save that changes any of them
remounts the card and drops unsaved input. Scenario images go away (5.1), and the key becomes `s.id`. The card keeps its own state;
after a successful save it takes the saved values as its new baseline (for the dirty check).

**R:** every editable card on the requests pages follows the same rule: key by id only, never by content.

### 1.3 Resolve dialog flickers and closes on typing
Cause: `DisasterPanel` queries `disasterState` with `note` in the query key, so every keystroke is a new key, `view` is `undefined`,
the panel returns `null`, and the dialog unmounts. Fix: the query no longer takes the note. `disasterView` returns the template parts
and the client fills `{note}` for the preview locally (`buildResolvedEmbed` is pure and importable on the client, see 4.1). The panel
never returns `null` once loaded (`placeholderData: keepPreviousData` on the remaining query).

### 1.4 "Speichere zuerst deine Änderungen." twice
`PostCard` renders the post reason (`reasonDirty`) and the test-send reason (`reasonDirty`) as two lines. Show the dirty hint once,
above the button row, and drop it from both specific reason lines.

### 1.5 Deleting a post wipes its text
`events.delete` marks the post `deleted`; `listPosts` hides deleted posts, so the composer opens empty. **R:** after the last message is
removed, the worker (same transaction) inserts a new `draft` post of the same kind with the same `text`, `pingRole` and `embed`
(team/announcement/reminder only; a deleted disaster or resolved post gets no copy). The user can post again or edit first.
The delete confirmation text says "The messages are removed from Discord. Your text stays here as a draft."

### 1.6 "Completing clears the messages"
The dev DB shows the user deleted the four posts before marking the event done (18:38:08-18:38:35, then `done` at 18:38:46), so this
is 1.5. Mark-done itself changes no post. Add a test that `markDone` leaves every post row untouched. A done or cancelled request
shows its posts read-only with their text and status.

---

## 2. Brief

### 2.1 No empty version 1
`createRequest` writes brief version 1 only when the brief is non-empty after trimming. A request without a brief has
`brief_version = 0`.
- Migration: default of `event_request.brief_version` becomes `0`. Delete `event_brief_version` rows with `version = 1` and an empty
  body whose request has `brief_version = 1`, then set those requests' `brief_version = 0`.
- `getRequest`, `getBrief`, prompts, `get_request` and the Discord payload treat version 0 as an empty brief (no row read).
- `saveBrief` with `baseVersion: 0` writes version 1. `saveBriefInput.baseVersion` becomes `min(0)`.
- Brief history shows "No versions yet" for version 0.

### 2.2 A real Markdown editor
New shared component `src/components/markdown-editor.tsx` (no new dependency):
- Toolbar (icon buttons with tooltips, lucide icons): heading, bold, italic, strikethrough, inline code, link, quote, bullet list,
  numbered list, task list, code block, horizontal rule.
- Shortcuts: Ctrl/Cmd+B, I, K (link), Shift+Ctrl/Cmd+7/8 (numbered/bullet). Tab / Shift+Tab indent and outdent list lines.
- Enter in a list item continues the list (`- `, `1. ` incremented, `- [ ] `); Enter on an empty item ends the list.
- Modes: Write, Preview, Split (side by side from `lg`; Split is the default on `lg`, Write below). Preview uses the existing `Markdown`.
- Autosize between a min and max height; character counter when `maxLength` is set.
- Props: `value`, `onChange`, `maxLength?`, `minRows?`, `placeholder?`, `disabled?`, `id?`, `aria-label?`, `variant?: "full" | "compact"`
  (compact: smaller toolbar, no Split, used inside dialogs), `footer?: ReactNode`.
- Pure text helpers in `src/lib/markdown-edit.ts` (wrap selection, toggle line prefix, continue list, indent) with unit tests.

Used by: the brief editor, the page editor (`src/components/pages/page-editor.tsx`), the disaster note, the resolve note, the cancel
note, the fallback "what we do" field, and the Messages editors (with the placeholder chips as an extra toolbar group).

---

## 3. Defaults removed

### 3.1 Fallback scenarios
`REQUIRED_FALLBACKS` keeps only `server-down` ("Server dies mid-event"). New requests get that one scenario.
Migration: for `staff-missing` and `too-few-players` rows, delete the ones with empty `what_we_do`, `who_decides` and null
`player_message`; set `required = false` on the rest (data kept, no longer blocking).

### 3.2 Event-day checklist
`CHECKLIST_TEMPLATE` is removed; `seedRequestDefaults` creates no checklist items. Migration: delete checklist items with a non-null
`key` and null `done_at`. Rendering falls back to `label` for any remaining keyed item. The checklist starts empty; the developer's
agent fills it over MCP (6) and people with list rights add items by hand.

### 3.3 Check-in removed
Drop `event_checkin` (migration), its ops, router procedures, UI, i18n keys, the permissions-table row in `docs/event-requests.md`,
and its tests.

---

## 4. Dates, placeholders, prompts, summary

### 4.1 Start and end instead of a duration
The Overview details form shows **Start** and **End** (`datetime-local`, event time zone shown as hint). The database keeps
`duration_minutes` (**R:** no column change; end = start + duration, so moving the start keeps the length).
- `updateRequestInput` gains `endsAt: dateSchema.nullable().optional()`. When `endsAt` is given, the op computes
  `durationMinutes = round((endsAt - startsAt)/60000)` from the new or stored start. `endsAt <= startsAt` is an InvalidError
  ("The end must be after the start."). `durationMinutes` stays accepted for MCP/REST callers.
- `durationSchema` max becomes 10080 (7 days). **R:** multi-day events are allowed.
- `RequestDetail.request` gains `endsAt: Date | null` (from `eventEnd`). `get_request` returns `endsAt` too.
- The accept dialog, the event-day header and the list show "start - end".

### 4.2 Placeholders
`PLACEHOLDERS` becomes:

| Name | In Discord text (content, embed description, field value) | Elsewhere (embed title, footer, Discord event, previews in plain text) |
| --- | --- | --- |
| `{event}` | title | title |
| `{start}` | `<t:S:F>` | `Samstag, 3. Oktober 2026 um 20:00 Uhr` |
| `{start_date}` | `<t:S:D>` | `3. Oktober 2026` |
| `{start_time}` | `<t:S:t>` | `20:00 Uhr` |
| `{end_date}` | `<t:E:D>` | date of the end |
| `{end_time}` | `<t:E:t>` | `22:00 Uhr` |
| `{countdown}` | `<t:S:R>` | empty |
| `{duration}` | `2 Stunden` | same |
| `{where}` `{docs}` `{rules}` | as before | as before |
| `{note}` | only in the disaster, resolved and cancelled templates | same |

`S`/`E` are Unix seconds. **R:** `{date}` and `{time}` stay as hidden aliases of `{start_date}`/`{start_time}` so old text still
works; the chips and docs show only the new names. Migration rewrites `{date}`→`{start_date}` and `{time}`→`{start_time}` in the
settings' three templates (jsonb text) and in `event_post.text` of drafts.
- `fillPlaceholders(template, values, { allow, mode })` with `mode: "discord" | "text"`; `placeholderValues` returns both forms.
- `buildDetailsEmbed`, `buildDisasterEmbed`, `buildResolvedEmbed`, `buildCancelledEmbed`: title and footer in `text` mode,
  description in `discord` mode. Post text in `discord` mode.
- Placeholders are filled only when the parts are planned at send (start, resume, edit, test send), never when a draft or paste-back
  is saved. (Already true; add a test that `savePostDraft` and `savePasteBack` store the text unchanged.)
- The in-app message preview renders `<t:N:X>` tokens as the formatted local time in the viewer's locale (`src/lib/discord-timestamp.ts`,
  `renderTimestamps(text, locale, timeZone)`), and renders Markdown like Discord does (reuse `Markdown`).

### 4.3 Prompts write placeholders
`buildPrompts` keeps the facts as context but adds a fixed German block "Platzhalter" listing every allowed placeholder with its
meaning, and the instruction: "Schreibe Datum, Uhrzeit, Dauer, Ort und Links nie aus, sondern nur als Platzhalter. Die App ersetzt sie
beim Senden; Datum und Uhrzeit erscheinen dann in der Zeitzone jedes Lesers." The facts block heading becomes "Zur Orientierung
(nicht abschreiben)". Tests check the block is present in all prompts and that no prompt asks for a literal date.

### 4.4 Short description
New column `event_request.summary text not null default ''` (max 500 characters).
- Edited in Overview (plain textarea with counter) and saved by a 4th copy prompt kind `summary` ("Kurzbeschreibung": 1-2 sentences,
  max 300 characters, no placeholders, no Markdown headings) whose paste-back writes `summary` through `updateRequest`.
- Discord scheduled event description: `summary` when non-empty, else the brief's first paragraph (as now), plus the `Infos:` line.
  A changed summary queues the Discord event update like other fields.
- Details embed: description = `summary` (when non-empty) + blank line + the template lines.
- `get_request` returns `summary`. **R:** the summary is not writable over MCP; the "external agent" in the user's words is the
  copy-prompt assistant, whose paste-back saves it.

### 4.5 Banner and images as thumbnails
`Embed` gains `imageAs?: "image" | "thumbnail"` (default `"image"`). `toDiscordEmbed` puts the attachment URL into `thumbnail` when
`"thumbnail"`. The details embed shows the banner as thumbnail. The disaster, resolved and cancelled embeds show their template image
as thumbnail. **R:** the Discord scheduled event keeps the banner as its cover image.

### 4.6 Text limit
**R:** keep a cap and raise it from 20,000 to 40,000 characters (20 messages plus the card). The worker already waits out 429s per
message; a webhook allows about 30 messages a minute per channel, so a 21-part post takes under a minute. A cap still guards the
database and the channel. `MAX_POST_TEXT = 40_000` exported from `src/lib/event-messages.ts` and used by the op schemas and the UI.

---

## 5. Störfall (disaster) flow

### 5.1 No scenario images
Drop `event_fallback.image_upload_id` (migration also deletes `event_upload` rows with `purpose = 'fallback'`; their files stay on
the volume, **R:** no file sweep). `fallback` leaves `UPLOAD_PURPOSES` for new uploads (old rows deleted).

### 5.2 One generic image
The Störfall section of Event settings has one image ("Störfall-Bild"), stored as `disasterTemplate.imageUploadId`, shown as the
thumbnail of the disaster **and** resolved embeds. The resolved template's own image field is removed from the editor (**R:** the
resolved embed uses the disaster image; `resolvedTemplate.imageUploadId` is ignored).

### 5.3 Notes on the disaster message
`postDisaster(db, actor, requestId, raw, queue)` with `raw = { note?: string }`: the note is Markdown, **R:** optional, max 1,500 characters. The
disaster template may hold `{note}`; the default template text becomes
`"{event} ist gerade nicht erreichbar. Wir arbeiten an einer Lösung und melden uns hier, sobald es weitergeht.\n\n{note}"`.
When the template has no `{note}` and a note is given, the note is appended after a blank line. The note is stored in
`event_post.note` of the disaster post. The post dialog uses the compact Markdown editor and shows the live embed preview.

### 5.4 Resolve is its own message
`resolveDisaster` no longer edits the disaster message. It marks the disaster post `resolvedAt = now` and creates a new post of kind
`resolved` (`note` = resolve note, `status: sending`, parts = one embed from the resolved template) and queues `events.post`. The
plain "ist wieder online" text message is gone; the resolved embed is that message. The disaster message stays as it was, for context.
The panel shows the resolved post's status with Resume/Delete like any post. The `events.resolve` job and its resume branch are
removed (**R:** in-flight resolve jobs in prod do not exist yet; v3 is unreleased).

### 5.5 Resolve dialog
Compact Markdown editor for the note (max 1,500), live preview filled on the client (1.3).

---

## 6. Event-day checklist over MCP

New tool `set_event_checklist` (MCP + REST, registered in `src/lib/tools/definitions.ts`):
- Input: `{ request: string, items: { label: string (1-200) }[] (max 30) }`.
- Replaces every **unticked** item of the request with `items` in order; ticked items stay, before the new ones. Logged in
  `request_log` (`field: "checklist"`, `newValue: "<n> items"`, `agent` set).
- Access: `develop` access to the request (developers, admins, editors/owners of the linked project) or `edit` access.
- Refused (Conflict) for done, withdrawn and cancelled requests.
`get_request` gains `checklist: { label, done }[]`.
Raise `TOOL_LIST_BUDGET_BYTES` by the measured size of the new tool plus 200 bytes headroom, with the reason in the commit message.
Plugin: `plugin/skills/event-requests/SKILL.md` gets a section "Event-day checklist": after the plan exists, write 5-12 concrete
checks for the event day from the plan and fallback scenario (who, what, when relative to start), and call `set_event_checklist`.
`plugin/commands/requests.md` gains `event-day <request-id>`. Bump the plugin version (patch).

---

## 7. Lifecycle: cancel, reopen, delete, confirmations

### 7.1 Statuses
`EDGES` becomes:
- `draft: [submitted, withdrawn]`, `submitted: [accepted, withdrawn, draft]`
- `accepted: [event_week, cancelled]`, `event_week: [done, cancelled]`
- `cancelled: [accepted]` (reopen), `withdrawn: [draft]` (**R:** a withdrawn request can be reopened as a draft, same idea)
- `done: []`
`isOpen` unchanged (cancelled is not open, but it is not final).

### 7.2 Cancel
- Cancel dialog: required note (compact Markdown editor, 1-1,000 characters, **R:** raised from 500). The note is stored as
  `event_request.cancel_note` (new column, nullable) and still logged.
- When the announcement has at least one message in Discord (`announcement` post with `posted`/`partial` and a stored message id),
  cancelling also creates a post of new kind `cancelled` (public webhook, no ping, one embed from the new `cancelledTemplate`,
  `{note}` = the cancel note) and queues `events.post`. The dialog says this and shows the embed preview. Without a sent announcement the
  dialog says "No cancel message is sent, because the announcement was not posted." and nothing is posted.
- Without a public webhook while the announcement is posted: the cancel still happens; the dialog warns that no message can be sent.
- `POST_KINDS` gains `cancelled`; `POST_TARGET.cancelled = "public"`. The cancelled post is shown on the Messages tab (read-only card
  with status, Resume and Delete).
- The Discord scheduled event is deleted (exists).
- New settings column `cancelled_template jsonb` (EmbedTemplate) default
  `{ title: "Event abgesagt", text: "{event} am {start_date} findet leider nicht statt.\n\n{note}", color: "#8a8f98", imageUploadId: null }`,
  edited in Event settings ("Absage"), with preview. Image: none of its own; **R:** the cancelled embed carries the banner as thumbnail
  when the request has one.
- Posting while `cancelled`: `POSTING_STATUSES` stays `accepted`/`event_week`, but the `events.post` worker accepts a `cancelled` kind post
  for a `cancelled` request.

### 7.3 Reopen
`reopenRequest(db, actor, requestId, queue)`: `cancelled → accepted` (manage or develop access, like cancel); `withdrawn → draft`
(edit access). Clears `cancel_note`. When the announcement was posted and the bot is configured, queues `events.discord-event` with
the new action `create` (calls `ensureDiscordEvent`). **R:** no "the event is back" message is posted automatically; the planner posts
an edit or a new message by hand. Logged as a status change.

### 7.4 Delete
`deleteRequest(db, actor, requestId, { project: "keep" | "archive" | "delete" })`:
- Allowed for `draft`, `submitted`, `withdrawn`, `cancelled`. Refused (Conflict) for `accepted`, `event_week`, `done`.
- Who: event managers and admins; the requester for their own `draft`/`withdrawn` request.
- Deletes the request row (cascade) and the upload files of its uploads (best effort, after commit).
- Discord: a cancelled request's messages stay in Discord as history (**R**); a remaining Discord event is deleted by a queued job
  before the row is gone (the job carries guild/event id in its data so it does not need the row).
- Project: new column `event_request.project_created boolean not null default false`, set to true by accept with "Create project".
  Migration backfill: true where the project's `created_at` is within 60 seconds after `accepted_at` (**R** heuristic). When
  `project_created` and the project still exists, the delete dialog asks: keep the project, archive it, or delete it. Archive calls `archiveProject` (`src/lib/ops/archive.ts`) and
  delete calls `deleteProject` (`src/lib/ops/projects.ts`), both owner-only, run after the request is deleted; options the actor lacks are disabled with the reason. A linked (not created)
  project is never offered for deletion; the link just goes.
- tRPC `requests.delete`, `requests.reopen`; no MCP tools.

### 7.5 Confirmations
Confirmation dialogs (`AlertDialog`) for: Mark done ("Complete event"), Withdraw, Start event week, Reopen, Delete (with the project
choice). Cancel keeps its own dialog. Submit and Recall need none.

---

## 8. UI rework of the requests pages

The user: the pages "feel lost, out of place, not finished, not like everything in the app". Target: they read as a part of the same
product as the project and system pages.

### 8.1 Principles
- Reuse the app's building blocks: `Page`, `PageHeader` with breadcrumbs, a facts line under the title (like the system page),
  `Panel`, `UnderlineTabs`, right rail of `border bg-card p-4` panels, `Badge`, `EmptyState`, `AlertDialog`, `DropdownMenu` for
  secondary actions, the app's category colours (`cat-*`) and type scale. No new ad-hoc bordered `<p>` banners.
- One primary action in the header (the next step of the lifecycle), everything else in a "More" dropdown.
- Banners become one "Needs attention" rail panel (open questions, incomplete fallback, late to-dos, Discord event problems).
- Every form saves explicitly with a visible dirty state per card ("Unsaved changes" + Save/Discard) and never loses input on
  refetch. No page-level "save everything" button.
- Empty states everywhere a list can be empty.
- Mobile: rail moves below content; tabs scroll horizontally.

### 8.2 List (`/requests`)
- Header: title, description, actions (Settings link for managers/devs, New request).
- Grouped sections instead of a flat table: "Needs you" (waiting on the actor: open questions for the requester, submitted for
  developers, late to-dos owned by the actor), "Upcoming" (accepted/event week by start), "Drafts and submitted", "Past" (done,
  cancelled, withdrawn; collapsed by default). Each row: date block (day/month), title, status badge in status colour, start-end time,
  requester avatar/name, project chip, attention badges.
- Filter chips stay as a compact toolbar (search by title, status chips, "Mine").

### 8.3 Request page
- Header: breadcrumbs (Requests / title), title, facts line (status badge, start-end, where, requester, linked project), presence of
  primary action + More menu.
- Lifecycle stepper under the header: Draft, Submitted, Accepted, Event week, Done (cancelled/withdrawn shown as a state with the reopen
  action and the cancel note).
- Tabs: Overview (default), Brief, Questions, Fallback, Prep, Messages, Event day. **R:** Overview becomes the default tab because it
  holds the summary of everything; Brief moves second.
- Overview: main column = summary, details (start, end, where, docs, summary), banner; rail = Needs attention, Discord (event link,
  bot status hint, post statuses at a glance), Build progress, Next to-dos (3), History (last 5, "Show all" opens a sheet).
- Brief: Markdown editor full width; versions in the rail.
- Fallback: scenario cards with Markdown "what we do", who decides, player message; add scenario as a ghost card.
- Prep: to-do list grouped by due (late, this week, later, done) with owner avatars.
- Messages: a timeline of the three posts in due order (team, announcement, reminder) plus disaster/resolved/cancelled posts as
  read-only entries; each card has the editor, a Discord-style preview (rendered Markdown, timestamps, the card), status and actions.
- Event day: event header card (countdown), checklist (agent-written items flagged "from the plan"), fallback scenarios, Störfall
  panel. The standalone `/requests/[id]/event-day` page uses the same layout without tabs.

### 8.4 Settings (`/requests/settings`)
Sections in a left sub-navigation like the project settings page (`settings-frame.tsx` + `SettingsNav` pattern, as in-page anchors or `?section=`): Posting (post-as, ping role, server, time zone, rulebook),
Webhooks and bot (admin), Writing style (styles and examples), Templates (details, Störfall with image, resolved, cancelled), each with
live preview side by side.

### 8.5 Process
The UI tasks run with the `frontend-design` skill loaded. A dev-server check in the browser (Claude in Chrome) of every tab in light
and dark at desktop and phone width is part of the final review. **R:** the user reviews the design afterwards; no mockup round.

---

## 9. Docs
`docs/event-requests.md` is updated for everything above (statuses, placeholders table, cancel/reopen/delete, Störfall, MCP tool,
removed check-in). The final report goes to `docs/superpowers/reports/v3.1-report.md`.

## 10. Testing
- Unit: markdown-edit helpers, placeholder modes and aliases, timestamp rendering, prompts, embeds with thumbnail, i18n format test.
- Ops (pglite): createRequest without brief, saveBrief from 0, lifecycle edges, cancel with/without posted announcement, reopen,
  delete with project choices and rights, delete keeps text as draft, resolve creates a resolved post and leaves the disaster parts
  untouched, set_event_checklist replace semantics and access, markDone leaves posts.
- Worker: delete job inserts the draft copy; cancelled post sends for a cancelled request; discord-event `create` action.
- Gate per task: `npm run lint`, `npm run typecheck`, the touched test files; final gate: full `npm test`, plugin tests, `npm run build`.
