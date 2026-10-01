# Event requests: user guide

An event request carries an event from the planner's idea to the day it runs: the brief, the date, a banner, the team's questions, a fallback plan, prep to-dos and the Discord messages. Open **Requests** in the sidebar.

Nothing in this feature acts on its own. Every Discord message is posted by a click, reminders are only notifications, and the app never calls Claude.

Status flow: `draft` → `submitted` → `accepted` → `event_week` → `done`. A request is `withdrawn` while it is a draft or submitted, and `cancelled` once it is accepted. The requester can recall a submitted request to a draft until a developer accepts it.

## Part 1: the planner

The planner is the requester of a request. Event managers and admins create requests (and may name another user as the requester).

### Create the request and write the brief

1. **Requests** → **New request**, give a title, **Create draft**.
2. On the **Brief** tab fill the details: start (shown in your time zone), duration in minutes, where, and the link to the event documents (an https link). Save with **Save details**.
3. Write the brief in Markdown. Every saved change is a new version; **Versions** lists them and **Compare with current** shows what changed. If someone saved in the meantime you get a conflict and reload first.
4. A request can be submitted when it has a title, a brief and an event date in the future. Once submitted, the date can no longer be cleared.

### Upload the banner

Under **Event banner** choose or drop a PNG, JPEG, WEBP or GIF image of at most 8 MiB. The banner is shown with the details card of the announcement and on the Discord event. A request can hold at most 40 images.

### Submit, and answer the team's questions

**Submit** sends the request to the developers. When the team needs more, it asks a round of up to 5 typed questions (text, single choice, multiple choice, number, date, time, yes/no, scale). They appear on the **Questions** tab and as a notification. Answer each one, or press **Not sure, let the team decide**: the developer then decides it with the team. Required questions need an answer or "Not sure". **Save answers** sends them.

### Fallback plan

The **Fallback** tab has three required scenarios: server dies mid-event, key staff missing, too few players. Each needs **What we do** and **Who decides**; a message for the players is optional (prepared in German, placeholders allowed). You can add more scenarios. **Start event week** (requester, event manager, developer or admin) is refused while a required scenario is incomplete, and the page lists what is open.

### Prep to-dos

Accepting a request creates six to-dos, due at 09:00 in the event time zone: post the team message (8 days before), post the announcement (7 days before), build is ready (3 days before), rehearsal (2 days before), post the reminder (the day before) and recap and thank-you (the day after). Their dates follow the event date until you set one by hand. You can add your own to-dos with an owner and a due date; template to-dos cannot be removed. Late and due-soon to-dos create notifications.

### Copy prompts and paste back

**Copy prompts** (on the Messages tab) builds a German prompt for the announcement, the reminder or the team message from the brief and your event settings. Copy it into any chat assistant, paste the text it writes back and **Save as draft**. The app calls no assistant itself.

### Post the messages

The **Messages** tab has one editor each for the team notice, the announcement and the reminder. The editor shows a live preview of how many Discord messages the text becomes. A request must be accepted (or in event week) before it posts, and an admin must have set the matching webhook.

- **Send to staff channel**: a test send of the saved draft. It goes to the staff channel only, never pings and never creates a Discord event.
- **Post now**: asks for confirmation, then posts. Announcement and reminder can ping the event role once, on their first message, when the ping box is ticked. The team notice never pings. Every post ends with the details card (date, time, duration, place, links), which carries the banner.
- Once any part of a post has been sent, its draft text is locked. Change it with **Edit**: it updates every sent message in place and never pings.
- **Delete messages** removes the messages from Discord (a Discord event stays).
- If a post stalls (shown as "Partly posted" or "Failed"): check the channel first, then press **Resume**. A crash between Discord answering and the database write can repeat one message.

The announcement also creates a real Discord scheduled event when a bot token and server ID are set and the request has an event docs link. If Discord refuses (permission denied, rejected, server error, rate limit), the announcement still posts with the details card and the post shows a note.

### Event day

During the event week the **Event day** tab shows the checklist (server checked by the host, staff online, rewards ready, fallback plan read), check-in and the fallback scenarios. Anyone signed in can open it in the event week, read the checklist and check themselves in; only the requester, event managers, developers and admins tick items.

### Disaster and resolve

If the event breaks, an event manager or the requester presses **Post disaster message** (only in the event week). It posts the disaster template to the public channel without pinging. When it is fixed press **Resolve**: the disaster message is edited into the resolved template and a plain new "back online" message follows (Discord webhooks cannot reply). The note field is optional and is filled into `{note}`. **Delete message** removes a stuck disaster message.

## Part 2: the developer

Event developers see requests once they are submitted.

1. **Questions.** In the plugin, `get_request` reads the brief, answers and progress; `ask_requester` asks a round of questions. Requester answers with "Not sure" come back in the top-level `notSure` list for you to decide.
2. **Accept.** On a submitted request press **Accept request**. Either **Create project** (the Event board, three phases, one system with the brief as spec version 1, deadline at the end of the event) or **Link to an existing project** (you must be an editor of it; pick a system or create a new one). A system belongs to at most one request, so linking one that is already linked elsewhere is refused. Linking writes no spec: the banner then reads "Brief not applied yet". The requester is not added to the project; they see a progress bar of task counts only.
3. **Brief changed.** When the requester edits the brief after the spec was written, the project shows **Brief changed since spec vN** with **Show changes**, and **Update from brief** gives you the command `/surf-roadmap:requests update <request-id>` to paste into your agent. The app runs nothing itself.
4. **`/surf-roadmap:requests`.** `/surf-roadmap:requests <request-id>` develops a request the first time, `update <request-id>` brings the system in line with the changed brief. Without an id the command asks for it (the last part of the request's URL), because there is no list tool. The skill `event-requests` reads `get_request` (use `specBasis.briefVersion` as `sinceBrief` to get the brief diff), plans the system with `plan-system`, asks the planner through `ask_requester` and reports with one `post_update`.
5. **Never delete done work.** Tasks in state `done` are never changed. Steps that the brief dropped keep their tasks and are listed in the report.

## Part 3: the admin

### Flags

On the **Accounts** page (Admin section) tick **Event manager** and/or **Event developer** per account. Admins hold both implicitly.

### Event settings and secrets

Event managers and admins open `/requests/settings` (**Event settings**); everyone else sees not-found. Managers change the post-as name, ping role id, server ID, time zone (default `Europe/Berlin`), rulebook link, style guides and examples, and the details, disaster and resolved templates (with a preview). **Only admins** set the three webhook URLs (public, team, staff test) and the bot token. They are encrypted with `ENCRYPTION_KEY`; nobody, admins included, sees them again, only `…••••abcd` hints. Create the webhooks in Discord (Channel settings → Integrations → Webhooks). The ping role id comes from Developer Mode → right-click the role → **Copy role ID**.

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

Templates (details lines, disaster and resolved messages, fallback player messages, message texts) may contain these. Dates and times use the event time zone from the settings, in German format.

| Placeholder | Value |
| --- | --- |
| `{event}` | the request title |
| `{date}` | the event date |
| `{time}` | the start time |
| `{duration}` | the length, for example `2 Stunden` or `1 Stunde 30 Minuten` |
| `{docs}` | the event documents link |
| `{rules}` | the rulebook link from the settings |
| `{where}` | the place |
| `{note}` | the note of **Resolve**; only in the resolved message |

An unknown placeholder stays as written. A known one without data becomes empty and the extra spaces around it collapse. Values are inserted as plain text and never scanned again.

German template examples:

```
Datum: {date}
Uhrzeit: {time} Uhr
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

## Permissions

| | Requester | Event manager | Event developer | Admin | Project member | Staff (event day) |
| --- | --- | --- | --- | --- | --- | --- |
| See the request | own | all | after submit | all | after submit | event-day page in event week |
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
| Event settings (not secrets) | no | yes | read only | yes | no | no |
| Webhooks and bot token | no | no | no | yes | no | no |
| Check in on event day | yes | yes | yes | yes | yes | yes |

## Out of scope

- No automatic posts: no scheduled messages, no automatic Discord events, no automatic status changes.
- No Claude calls from the app: prompts are copied out, text is pasted back, developers use their own agent through the plugin.
- No history of settings changes beyond who saved last and when.
- No list tool for requests in the plugin.
