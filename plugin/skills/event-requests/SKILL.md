---
name: event-requests
description: Develop an event request that was accepted into this project, or update its system after the requester changed the brief. Reads the request with get_request, plans the system with the requester answering event questions through ask_requester, and keeps spec, plan and tasks in line with the brief without touching finished work. Use when /surf-roadmap:requests runs, when the project shows "Brief changed since spec vN", or when a system belongs to an event request.
argument-hint: "[update] <request-id>"
---

# surf-roadmap:event-requests

An event request is a brief written by an event planner without developer skills. The
app turns an accepted request into a project and system; you build it with the developer.

## Guarded rules

- Never change a task in state `done`. Add or change work, never delete done work.
- Never answer for the requester. Only their answers, read through `get_request`, count.
- Never post to Discord. The app does that from its own buttons.
- Questions about the event go to the requester with `ask_requester`; technical questions
  go to the developer (the user) in the conversation.

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
   Tasks of steps the brief dropped stay as they are and are reported in step 4.
   Questions the change opens go to the requester with `ask_requester`.
4. **Report** what changed (spec sections, plan steps, tasks added, changed and left
   because their step was removed) in one `post_update`.
