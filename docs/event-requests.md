# Event requests: user guide

An event request carries an event from the planner's idea to the day it runs: the brief, the date, a banner, the team's questions, a fallback plan, prep to-dos and the Discord messages. Open **Requests** in the sidebar.

Nothing in this feature acts on its own. Every Discord message is posted by a click, reminders are only notifications, and the app never calls Claude.

Status flow: `draft` → `submitted` → `accepted` → `event_week` → `done`. A request is `withdrawn` while it is a draft or submitted, and `cancelled` once it is accepted. The requester can recall a submitted request to a draft until a developer accepts it.

Two ways back: **Reopen** turns a `cancelled` request into `accepted` again and a `withdrawn` one into a `draft` (the cancel note is cleared). A `done` request is final. A request that is a `draft`, `submitted`, `withdrawn` or `cancelled` can be deleted (see [Cancel, reopen and delete](#cancel-reopen-and-delete)). Steps that are hard to undo (Complete event, Withdraw, Start event week, Reopen, Delete) ask for confirmation first.

## Part 1: the planner

The planner is the requester of a request. Event managers and admins create requests (and may name another user as the requester).

### Create the request and write the brief

1. **Requests** → **New request**, give a title, **Create draft**.
2. On the **Overview** tab fill the details: **Start** and **End** (entered in your own time zone, the one in your account preferences, UTC until you set one; the app stores the length, so moving the start keeps it; events of up to 7 days are fine), where, the link to the event documents (an https link) and the short description. Every card shows "Unsaved changes" until you save it.
3. Write the brief on the **Brief** tab in the Markdown editor (toolbar, shortcuts, Write, Preview or Split). A new request starts with an empty brief and no version; the first save is version 1. Every saved change is a new version; **Versions** lists them and **Compare with current** shows what changed. If someone saved in the meantime you get a conflict and reload first.
4. A request can be submitted when it has a title, a brief and an event date in the future. Once submitted, the date can no longer be cleared.

The **short description** (at most 500 characters) is one or two sentences. It is the description of the Discord event (instead of the brief's first paragraph) and the first lines of the details card. Write it by hand or let an assistant do it: **Copy prompts** has a "Kurzbeschreibung" prompt, and the pasted answer is saved with **Save as short description**.

### Upload the banner

Under **Event banner** choose or drop a PNG, JPEG, WEBP or GIF image of at most 8 MiB. The banner is shown with the details card of the announcement and on the Discord event. A request can hold at most 40 images.

### Submit, and answer the team's questions

**Submit** sends the request to the developers. When the team needs more, it asks a round of up to 5 typed questions (text, single choice, multiple choice, number, date, time, yes/no, scale). They appear on the **Questions** tab and as a notification. Answer each one, or press **Not sure, let the team decide**: the developer then decides it with the team. Required questions need an answer or "Not sure". **Save answers** sends them.

### Fallback plan

The **Fallback** tab starts with one required scenario: server dies mid-event. It needs **What we do** (Markdown) and **Who decides**; a message for the players is optional (prepared in German, placeholders allowed). You can add more scenarios; they are optional. **Start event week** (requester, event manager, developer or admin) is refused while a required scenario is incomplete, and the page lists what is open.

### Prep to-dos

Accepting a request creates six to-dos, due at 09:00 in the event time zone: post the team message (8 days before), post the announcement (7 days before), build is ready (3 days before), rehearsal (2 days before), post the reminder (the day before) and recap and thank-you (the day after). Their dates follow the event date until you set one by hand. You can add your own to-dos with an owner and a due date; template to-dos cannot be removed. Late and due-soon to-dos create notifications.

### Copy prompts and paste back

**Copy prompts** (on the Messages tab) builds a German prompt for the announcement, the reminder, the team message or the short description from the brief and your event settings. The prompt lists the allowed placeholders and tells the assistant to write dates, times, duration, place and links only as placeholders, never as literal text. Copy it into any chat assistant, paste the text it writes back and **Save as draft**. The app calls no assistant itself. A developer's agent can also write the drafts directly (Part 2).

### Post the messages

The **Messages** tab has one card each for the team notice, the announcement and the reminder, and read-only cards for the disaster, resolved and cancel messages once they exist. Each card has a Markdown editor (with placeholder chips and a count of how many Discord messages the text becomes; at most 40,000 characters) and a collapsible **Discord-Vorschau**, closed by default. The preview works for all three messages, also for text you have not saved yet: it renders Markdown the way Discord does, shows the date placeholders as times in your own time zone and shows the details card. A request must be accepted (or in event week) before it posts, and an admin must have set the matching webhook.

- **Send to staff channel**: a test send of the saved draft. It goes to the staff channel only, never pings and never creates a Discord event.
- **Post now**: asks for confirmation, then posts. Announcement and reminder can ping the event role once, on their first message, when the ping box is ticked. The team notice never pings. The details card is a summary (the short description) followed by the lines of the details template (by default start, end, place, docs and rules), with the banner as its thumbnail.
- Once any part of a post has been sent, its draft text is locked. Change it with **Edit**: it updates every sent message in place and never pings.
- **Delete messages** removes the messages from Discord (a Discord event stays). Your text stays on the card as a new draft, so you can post it again or edit it first.
- If a post stalls (shown as "Partly posted" or "Failed"): check the channel first, then press **Resume**. A crash between Discord answering and the database write can repeat one message. A post that shows "Sending" for more than six minutes has lost its job (for example after a worker crash); Resume and Delete work again then.

The announcement also creates a real Discord scheduled event when a bot token and server ID are set and the request has an event docs link. If Discord refuses (permission denied, rejected, server error, rate limit), the announcement still posts with the details card and the post shows a note.

### Event day

During the event week the **Event day** tab shows an event header with a countdown, the checklist, the fallback scenarios and the Störfall panel. There is no separate event-day page and no check-in: you need access to the request to see the tab. The checklist starts empty. A developer's agent fills it from the plan (`set_event_checklist`, Part 2) and people who may edit the request add items by hand. Only the requester (while the request is open), event managers, developers and admins tick items, and only in the event week.

### Disaster and resolve

If the event breaks, an event manager or the requester presses **Post disaster message** (only in the event week). It posts the disaster template to the public channel without pinging. The dialog has an optional note (Markdown, at most 1,500 characters) with a live preview. It goes into `{note}` of the template, or is appended after a blank line when the template has no `{note}`. When it is fixed press **Resolve**: the disaster message stays as it was and a new message from the resolved template follows (Discord webhooks cannot reply); its optional note fills `{note}`. The panel shows the status of both messages, with Resume and Delete like any post. **Delete message** removes a stuck disaster message. Both embeds show the one shared Störfall image (Part 3) as a thumbnail.

### Cancel, reopen and delete

- **Cancel** (event manager, developer or admin, for an accepted or event-week request) asks for a note (Markdown, 1 to 1,000 characters). If the announcement is in Discord, cancelling also posts the cancel message (the "Absage" template, no ping, `{note}` is your note, the banner as thumbnail); the dialog shows the preview. If the announcement was never posted, or no public webhook is set, the dialog says so and sends nothing. A Discord scheduled event is deleted.
- **Reopen** brings a cancelled request back to accepted (a withdrawn one back to a draft). Nothing is posted automatically; edit or post a message by hand. When the announcement was posted and the bot is set up, the Discord event is created again.
- **Delete** is offered for drafts, submitted, withdrawn and cancelled requests: event managers and admins always, the requester for their own draft or withdrawn request. Accepted, event-week and done requests cannot be deleted. The request and its uploaded images go; messages already in Discord stay there as history, a remaining Discord event is removed. If the request created its project (Accept, **Create project**) and the project still exists, the dialog asks whether to keep, archive or delete it. Archiving and deleting are for project owners only; options you may not use are disabled with the reason. A project that was only linked is never deleted.

## Part 2: the developer

Event developers see requests once they are submitted.

1. **Questions.** In the plugin, `get_request` reads the brief, answers and progress; `ask_requester` asks a round of questions. Requester answers with "Not sure" come back in the top-level `notSure` list for you to decide.
2. **Accept.** On a submitted request press **Accept request**. Either **Create project** (the Event board, three phases, one system with the brief as spec version 1, deadline at the end of the event) or **Link to an existing project** (you must be an editor of it; pick a system or create a new one). A system belongs to at most one request, so linking one that is already linked elsewhere is refused. Linking writes no spec: the banner then reads "This system was linked to an existing spec; the brief was not applied to it." The requester is not added to the project; they see a progress bar of task counts only.
3. **Brief changed.** When the requester edits the brief after the spec was written, the project shows **Brief changed since spec vN** with **Show changes**, and **Update from brief** gives you the command `/surf-roadmap:requests update <request-id>` to paste into your agent. The app runs nothing itself.
4. **`/surf-roadmap:requests`.** `/surf-roadmap:requests <request-id>` develops a request the first time, `update <request-id>` brings the system in line with the changed brief. Without an id the command asks for it (the last part of the request's URL), because there is no list tool. The skill `event-requests` reads `get_request` (use `specBasis.briefVersion` as `sinceBrief` to get the brief diff; it also returns `endsAt`, `summary`, the `checklist` and `writing`, the style guides and examples to write in), plans the system with `plan-system`, asks the planner through `ask_requester` and reports with one `post_update`.
5. **Event-day checklist.** `set_event_checklist` replaces the unticked items of the checklist with 1 to 30 concrete checks (ticked items stay). `/surf-roadmap:requests event-day <request-id>` writes 5 to 12 of them from the plan and the fallback scenarios. It needs develop or edit access and is refused for done, withdrawn and cancelled requests.
6. **Messages.** `write_event_messages` writes the drafts of the team notice, the announcement and the reminder and the short description in one call, exactly as given (use placeholders; the app fills them when it sends). It never posts: a kind that is already sending, partial or posted is skipped with a reason while the others are saved. `/surf-roadmap:requests messages <request-id>` does it from `get_request`'s `writing`. Posting stays a click in the app.
7. **Never delete done work.** Tasks in state `done` are never changed. Steps that the brief dropped keep their tasks and are listed in the report.

## Part 3: the admin

### Flags

On the **Accounts** page (Admin section) tick **Event manager** and/or **Event developer** per account. Admins hold both implicitly.

### Event settings and secrets

Event managers and admins open `/requests/settings` (**Event settings**); everyone else sees not-found. Managers change the post-as name, the **Absender-Bild** (sender image), ping role id, server ID, time zone (default `Europe/Berlin`), rulebook link, the writing styles and examples (team, announcement, reminder and **Kurzbeschreibung**) and the details, disaster ("Störfall"), resolved and cancelled ("Absage") templates (each with a preview).

The **Störfall image** is one shared image: it is the thumbnail of the disaster message and of the resolved message (the resolved template has no image of its own). The cancel message uses the request's banner as thumbnail.

The **sender image** is the avatar of every message the app posts. Discord loads it from the app's public address `/api/uploads/public/<id>`, which serves a file only while it is the configured sender image. Discord can show it only when the app is reachable on a public URL (`BETTER_AUTH_URL`), not on `localhost`. **Only admins** set the three webhook URLs (public, team, staff test) and the bot token. They are encrypted with `ENCRYPTION_KEY`; nobody, admins included, sees them again, only `••••abcd` hints (the last four characters). Create the webhooks in Discord (Channel settings → Integrations → Webhooks). The ping role id comes from Developer Mode → right-click the role → **Copy role ID**.

### Bot (optional)

For real Discord events create a bot in the developer portal and invite it with the **Manage Events** and **Create Events** permissions. The app uses the REST API only; it needs no gateway and no intents. The settings page shows the last answer of Discord to the token: ok, denied or missing permissions.

### Uploads volume

Images live in `EVENT_UPLOADS_DIR` (default `/data/uploads`), the named volume `roadmap-uploads`, mounted in `app` and `worker`. Files are served at `/api/uploads/<id>` behind an access check. They are publish-once, so no backup is needed. A bind mount needs `chown 1000:1000` because the containers run as the `node` user.

### Troubleshooting

- **Webhook answered 404 (code 10015) or 401.** The webhook was deleted or its URL changed. Posts, edits and deletes stop with an error that names the setting. Create a new webhook, paste it in Event settings, then press **Resume** or retry. A message that Discord no longer has (code 10008) counts as already gone.
- **Post stuck `partial`.** Some parts were sent and one was not. Check the channel for what arrived, then **Resume**; only parts without a stored message id are sent. If the post is unusable, **Delete messages** and post again.
- **Discord event denied.** The bot token is wrong (denied) or the bot lacks Manage Events or Create Events (missing permissions); the settings page shows which. The announcement is still posted with the details card and a note on the post. Fix the bot's permissions and create the event by posting again, or create it in Discord by hand.
- **Uploads folder not writable.** `app` or `worker` refuses to start (or an upload fails) with a message naming `EVENT_UPLOADS_DIR`. Check that the volume is mounted in both, and for a bind mount run `chown 1000:1000` on it.
- **Sign-in rejected.** A person who signs in with an account that is not on the allowlist sees their Discord ID on the login page (kept in a short-lived httpOnly cookie, never in a URL) to send to an admin.

## Placeholders

Templates (details lines, disaster, resolved and cancelled messages, fallback player messages, message texts) may contain these. In Discord text (message text, embed descriptions) the date and time placeholders become Discord timestamps, so every reader sees them in their own time zone. In embed titles and footers, the Discord event and plain-text previews they are written out in the event time zone from the settings, in German format.

| Placeholder | In Discord text | Elsewhere |
| --- | --- | --- |
| `{event}` | the request title | the same |
| `{start}` | start, long form (weekday, date, time) | `Samstag, 3. Oktober 2026 um 20:00 Uhr` |
| `{start_date}` | start date | `3. Oktober 2026` |
| `{start_time}` | start time | `20:00 Uhr` |
| `{end_date}` | end date | the date of the end |
| `{end_time}` | end time | `22:00 Uhr` |
| `{countdown}` | a live countdown ("in 3 days") | empty |
| `{duration}` | the length, for example `2 Stunden` or `1 Stunde 30 Minuten` | the same |
| `{docs}` | the event documents link | the same |
| `{rules}` | the rulebook link from the settings | the same |
| `{where}` | the place | the same |
| `{note}` | the note of the disaster, resolved or cancel message; only in those templates | the same |

`{date}` and `{time}` still work as aliases of `{start_date}` and `{start_time}`, so older texts keep working; the chips and this guide show only the new names. An unknown placeholder stays as written. A known one without data becomes empty and the extra spaces around it collapse. Values are inserted as plain text and never scanned again. Placeholders are filled when a message is sent, never when a draft is saved. The Discord-Vorschau shows the timestamps as local times.

German template examples:

```
Datum: {start_date}
Uhrzeit: {start_time}
Dauer: {duration}
Ort: {where}
Infos: {docs}
```

```
{event} ist gerade nicht erreichbar. Wir arbeiten an einer Lösung und melden uns hier, sobald es weitergeht.
```

```
{event} läuft wieder. {note}
```

```
{event} am {start_date} findet leider nicht statt.

{note}
```

## Permissions

| | Requester | Event manager | Event developer | Admin | Project member | Staff |
| --- | --- | --- | --- | --- | --- | --- |
| See the request | own | all | after submit | all | after submit | no |
| Create a request | no | yes | no | yes | no | no |
| Edit brief and details | own, while open | always | no | always | no | no |
| Submit, recall, withdraw | own | yes | no | yes | no | no |
| Answer questions | own | yes | no | yes | no | no |
| Ask questions | no | no | yes | yes | editor or owner of the linked project | no |
| Accept into a project | no | no | yes | yes | no | no |
| Post, edit, delete messages | own, while accepted or in event week | yes | no | yes | no | no |
| Mark done | own, while open | yes | no | yes | no | no |
| Start event week | own, while open | yes | yes | yes | editor or owner of the linked project | no |
| Cancel | no | yes | yes | yes | no | no |
| Reopen (cancelled to accepted, withdrawn to draft) | withdrawn: own | yes | cancelled only | yes | no | no |
| Delete (draft, submitted, withdrawn, cancelled) | own draft or withdrawn | yes | no | yes | no | no |
| Write drafts and checklist over MCP | own, while open | yes | yes | yes | editor or owner of the linked project | no |
| Event settings (not secrets) | no | yes | read only | yes | no | no |
| Webhooks and bot token | no | no | no | yes | no | no |

## Out of scope

- No automatic posts: no scheduled messages, no automatic Discord events, no automatic status changes.
- No Claude calls from the app: prompts are copied out, text is pasted back, developers use their own agent through the plugin.
- No history of settings changes beyond who saved last and when.
- No list tool for requests in the plugin.
