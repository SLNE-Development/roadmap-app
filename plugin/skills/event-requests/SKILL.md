---
name: event-requests
description: Develop an event request that was accepted into this project, or update its system after the requester changed the brief. Reads the request with get_request, plans the system with the requester answering event questions through ask_requester, and keeps spec, plan and tasks in line with the brief without touching finished work. Use when /surf-roadmap:requests runs, when the project shows "Brief changed since spec vN", or when a system belongs to an event request.
argument-hint: "[update|event-day|messages] <request-id>"
---

# surf-roadmap:event-requests

An event request is a brief written by an event planner without developer skills. The
app turns an accepted request into a project and system; you build it with the developer.

## Guarded rules

- Never change a task in state `done`. Add or change work, never delete done work.
- Never answer for the requester. Only their answers, read through `get_request`, count.
- Never post to Discord. The app does that from its own buttons.
- Questions about the event go to the requester with `ask_requester` on this request, also
  inside `surf-roadmap:plan-system` and when the planner is "not here". Never put them in
  `add_question`, a planning round answered by the user, or the project. Technical
  questions go to the developer (the user) in the conversation.

## Steps

1. **Read the request.** `get_request` with `request` (the id). When updating, also set
   `sinceBrief` to `specBasis.briefVersion` from the first `get_request` (the brief version the
   spec was written from; the banner shows the spec version, not this number) so the result
   carries the brief diff. Read the brief and every answer. The top-level `notSure` list holds
   the questions the requester left to the developer: decide them with the user, and record each
   as an ADR with `surf-roadmap:new-adr` when it meets the ADR criteria.
2. **First time:** run `surf-roadmap:plan-system` on the linked system (the one
   `get_request` reports), using the brief as the idea. Ask the
   requester through `ask_requester` for anything about the event, the user for anything
   technical. Per round at most 5 questions, each with a `type`, `text`, a `why`, a
   `suggested` value where you have one, `required: true` only where the build truly cannot
   continue without it, at most 8 `options`, and no branching (no question depends on another
   answer in the same round). Read the answers on the next `get_request`. The input of
   `ask_requester` carries the request id next to the questions:

   ```json
   { "request": "<request-id>", "questions": [{ "type": "yesno", "text": "Is a rehearsal possible?", "why": "Decides the build date", "required": true }] }
   ```
3. **Update** (the brief changed): read the diff, then
   - `write_spec` with `body` and `brief` set to the brief version you read (this records
     the basis and clears the banner),
   - `write_plan` with all steps: existing steps keep their numbers, new steps get new numbers,
   - `update_tasks` and `add_tasks` to change or add tasks for changed or new steps.
   Tasks of steps the brief dropped stay as they are and are reported in step 5.
   Questions the change opens go to the requester with `ask_requester`.
4. **Event-day checklist** (`event-day <request-id>`, or after the plan is written): write 5-12
   concrete checks for the day of the event from the spec, the plan and the fallback scenarios.
   Each check names an owner and a time relative to the start (for example "Developer: join
   the server 30 minutes before start and check the player list"), one action per check, no
   generic wishes. Send them with `set_event_checklist` (`request` plus `items`, each with a
   `label`); it replaces the open items, ticked items stay.

   ```json
   { "request": "<request-id>", "items": [{ "label": "Developer: restart the server 60 minutes before start" }] }
   ```
5. **Report** what changed (spec sections, plan steps, tasks added, changed and left
   because their step was removed) in one `post_update`.

## Write the event messages

`messages <request-id>`: write the Discord drafts of an event. Nothing is posted; the planner
posts from the app.

1. Read `get_request` (brief, answers, fallback and `writing`: placeholders, styles, examples,
   rulebook link and the live `messages`).
2. Write the team notice, the announcement and the reminder in German, following
   `writing.styles` and `writing.examples`. Use the placeholders for date, time, place and links
   (for example `{start_date}`, `{start_time}`, `{where}`, `{docs}`), never a literal date. They stay
   as written; the app fills them when it sends.
   - Team notice: the fallback plan and who does what.
   - Announcement: starts with `# <event name>`.
   - Reminder: short.
   Also write a short description (`summary`, at most 300 characters, no placeholders, no Markdown)
   in the `writing.styles.summary` style.
3. Call `write_event_messages` with `request`, `team`, `announcement`, `reminder` and `summary`.
   Set `pingRole.announcement` to true unless the planner said otherwise.

   ```json
   { "request": "<request-id>", "announcement": "# {event}\n...", "pingRole": { "announcement": true } }
   ```
4. Report what was saved and what was skipped (a message that is already posted is skipped; it is
   changed with Edit in the app) and remind the user that posting happens in the app.
