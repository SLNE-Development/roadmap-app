---
description: Develop an event request, or update its system after the brief changed
argument-hint: "[update <request-id> | list | <request-id>]"
---

Read `surf-roadmap.json` for the project. Then follow the `surf-roadmap:event-requests`
skill for: $ARGUMENTS

- `update <request-id>`: the brief changed; update the linked system (skill, update path).
- `<request-id>`: first-time development of that request (skill, first-time path).
- `list` or no argument: there is no list tool. Ask the user for the request id from the
  "Requests" page of the app (the id is the last part of the request's URL), then continue
  with it. Do not guess ids and do not call `list_projects` to find requests.
