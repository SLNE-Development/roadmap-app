# Event requests: decisions

Source of truth for the event request system (roadmap-app v3). Built on top of v2 (Parts 0–9). Proposal page with mockups: https://claude.ai/artifact/Lg2A6Y5tTnuBbDyyfZWsqQ

## Model
- A **request** is its own entity, outside projects, owned by its requester (the event planner). It holds: title, event date/time and duration, the brief, an **event docs URL** (our own docs page for this event), uploaded images, questions and answers, a required fallback plan, prep to-dos, event-day checklist, announcements, status.
- Status: `draft` → `submitted` → `accepted` → `event_week` → `done` (plus `withdrawn`, `cancelled`).
- A developer accepts a request with **Create project from request** (default; the brief becomes the first spec draft, the event date the project deadline, template "Event") or **Link to an existing project**. Request and project are linked both ways; the request shows build progress from the project's tasks.
- **Brief versions:** every brief edit saves a version. The linked project shows "Brief changed since spec vN" with a diff. A developer runs the agent ("Update from brief"), which writes the next spec and plan versions and adjusts tasks (adds/changes, never deletes done work) and asks follow-up questions. Nothing runs on its own.

## People and permissions
- **Event manager:** a per-user flag set by an admin. Sees all requests, creates requests, edits event settings (everything except secrets).
- **Requester:** creates and edits own requests, answers questions, runs prep and event day for own requests.
- **Event developer:** a per-user flag set by an admin. Admins and event developers may accept requests and create/link the project.
- **Secrets** (webhook URLs, bot token) are admin-only; shown masked (••••abcd) to event managers.

## Event settings (one page, reachable from the Requests page; event managers edit, admins also edit secrets)
- **Public announcement webhook** (#event-announcements), post-as name, **ping role** (@Event-Ping, role id).
- **Team webhook** (server team channel) — new, separate.
- **Staff test webhook** (#event-staff) for test sends.
- **Bot token + guild id** (optional) for real Discord scheduled events.
- **Rulebook URL** (global, printed in every announcement and team message).
- **Announcement style guide** + example announcement + example reminder (German, full prose, see Messages).
- **Team message style** + example.
- **Disaster message template** ("Wir arbeiten an einer Lösung") and **resolved template** ("Das Event ist nun wieder online"), each an embed with title, text, colour, optional image; with placeholders.
- **Details template** (detail lines, colour, footer) for the fallback embed when no bot token is set.
- **Placeholders** usable in templates: `{event}`, `{date}`, `{time}`, `{duration}`, `{docs}` (event docs URL), `{rules}` (rulebook URL), `{where}`, `{note}` (resolved only).

## Messages (nothing is sent automatically — every post is a click by a person)
- **Team notification:** posted to the team webhook **1 day before the public announcement**. Contains the general event information and moderation requirements (from the planning questions), rulebook link, event docs link. Never pings, never creates a Discord event.
- **Announcement:** posted to the public webhook, due 7 days before the event. German full text: `# <event name>` then flowing paragraphs, never a bullet dump of the brief. Pings the role **only on the first message of the first post**. Event docs link and rulebook link printed in the text/footer.
- **Reminder:** due 1 day before the event, same style, shorter, no ping unless chosen.
- **Long posts are split** into several Discord messages (≤ 2,000 characters each, split at paragraph boundaries). The **event card or details embed is always its own last message**. The DB stores **every message id** per post (ordered), so each part can be edited or deleted; edits never ping (`allowed_mentions: { parse: [] }`).
- **Real Discord event** (if a bot token is set): created when the announcement is posted (by that click), updated when the date changes, deleted when cancelled. Its description links the **event docs URL**; the embed's url is the event docs URL too. Image = uploaded banner.
- **Test sends** go to the staff test webhook, never ping, and **never create the Discord event** (no spoilers).
- **Disaster message:** event-day button "Post disaster message": the admin template with placeholders filled, posted to the public webhook, **no ping**. **Resolve:** the disaster message is edited to the resolved template and a short "wieder online" reply is posted; the publisher may append an optional note (`{note}`).
- **Editing/deleting** sent posts: PATCH/DELETE `{webhook}/messages/{id}` for each stored id; message ids come from `?wait=true` on send.

## Prompts (no Claude on the planner's side)
- A **"Copy prompts"** dialog on the request page with three prompts, each with a Copy button and a paste-back field:
  1. **Announcement prompt** (the big event prompt): saved style + examples + full event info (brief, answers, schedule, rewards, where, fallback summary, docs and rules links) + "write the announcement in German".
  2. **Reminder prompt**: style + event essentials + "write the reminder".
  3. **Team prompt**: team style + general info + moderation requirements + staffing + fallback plan + links.
- Prompts are generic (no product names); the planner pastes them into any chat assistant and pastes the text back.

## Questions
- The developer's agent asks typed question rounds with `ask_requester`: types `text`, `choice` (+ other), `multi` (+ other, min/max), `number` (unit, min/max), `date`, `time`, `yesno`, `scale`; each with `why`, `suggested`, `required`, and "Not sure, let the team decide". Limits: 5 questions per round, 8 options, no branching. Answers come back typed via `get_request`.
- The planning skill must cover **moderation requirements** (staff roles and count, chat rules, what is punished, banned items/behaviour, who is on call) so the team prompt has them.

## Fallback plan (required before `event_week`)
- Scenarios with: what we do, who decides, optional prepared player message, optional image. Required scenarios: **server dies mid-event**, **key staff missing**, **too few players**. More can be added.

## Prep and event day (manual)
- Prep to-dos from a template, dated relative to the event (team message −8 d, announcement −7 d, build ready −3 d, rehearsal −2 d, reminder −1 d, recap +1 d), each with owner and due date; reminders are notifications only.
- Event-day checklist ticked by people (server checked by the host, staff online, rewards ready, fallback read). Staff check in themselves.

## Uploads
- Images (event banner, embed images for fallback/team/disaster messages) are uploaded in the app and stored on a **local Docker volume**; no backups needed (publish-once files). Sent to Discord as attachments (`attachment://`) or as the scheduled event's image.

## Never stuck
- Login page shows the Discord ID for admins; pickup reminders to admins/event devs after 2 working days; "Not sure" answers go to the developer; "Waiting on you" banner + reminders after 1 and 3 days; late to-dos turn red and remind the owner; event-day problems surface the fallback plan and the disaster button.

## Out of scope
- Automatic actions of any kind (scheduled posts, automatic server checks).
- Claude API calls from the app.
