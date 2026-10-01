# v3 report: Event requests

Branch `feat/v3` (off `main` 7982481), 21 commits, not pushed. Final gate on HEAD: lint and typecheck clean, 202 test files / 1819 tests pass, plugin tests 38/38 pass, and the fix wave ran `npm run build` green.

## What was built
All 16 plan tasks:
- **Requests:** event roles, requests with a status flow and brief versions, notifications, image uploads on a Docker volume, typed question rounds with "not sure" answers.
- **Agent side:** the `ask_requester` / `get_request` tools.
- **Projects:** accept into a new or linked project with a progress bar, the "Brief changed" banner and the plugin skill.
- **Event prep:** fallback plan, prep to-dos, event-day checklist and check-in, event settings with admin-only encrypted secrets.
- **Discord:** the post engine (split messages, stored ids, resume), edit, delete, test send, disaster and resolve, real Discord scheduled events.
- **Helpers:** the copy-prompts dialog, reminder notifications and "never stuck" banners, the Discord ID on the login page, docs.

The UI is translated into English and German (`events` namespace).

## How it was checked
- Every task had an implementer and a task review. Tasks 10 to 12 (secrets and the post engine) were reviewed on Opus.
- An Opus review of the whole branch found 6 Important issues and 5 minor ones. One fix wave fixed all 11, and an Opus re-review confirmed them.

## Rulings I made
1. Part 9 was already done. UI text is in English and German, and `"requests"` was added to the realtime key lists. There is no separate request SSE channel. Cost if wrong: request pages don't refresh live on changes that only touch the request.
2. `updateRequest` and `cancelRequest` take an optional queue and enqueue the Discord event sync after commit. Cost if wrong: the signature differs from the plan.
3. `requestFixture` creates the default fallbacks and checklist items, the same way real requests do.
4. Task 12 added `event_post.resolvedAt` and `editVersion` with its own migration.
5. When a webhook stops working there is no admin notification, only the post's error line. Cost if wrong: admins learn of a dead webhook only from the post card.
6. The manual Discord browser flow was not run (it needs sign-in and real webhooks). It is listed below.
7. Admins report the request role `manager`; `staff` is used only for the event-day page.
8. Uploads live at `/api/uploads` and `/api/uploads/<id>`, not `/api/events/uploads`, which clashed with the realtime route `/api/events/[project]`.
9. A developer asking questions on a draft gets 404 (invisible means 404), not 409.
10. A system belongs to at most one request. Cost if wrong: two requests can't share a system.
11. The event date can't be cleared after submit, and to-dos missing after a re-date are created. Cost if wrong: you must recall a request to remove its date.
12. A post's draft text is locked once any part is sent; changes go through Edit. A resume always ends with the card. Cost if wrong: Edit instead of editing a half-sent failed post.
13. Team notices also end with the details card. Cost if wrong: one extra card in the team channel.
14. A 5xx before any part is sent leaves the post `partial` (the plan said `failed`), so it stays resumable.
15. Edit and delete jobs carry the attempt number and are tied to the click that queued them. Cost if wrong: the job payloads differ from the plan.
16. The "back online" message is a plain message, not a threaded reply, because Discord webhooks can't reply.
17. Failing to create the Discord event never blocks the announcement: it falls back to the details card with a note. Cost if wrong: the announcement goes out without the event card when Discord's events API fails.
18. "Waiting on you" reminders also cover submitted requests; the plan said only accepted and event week. Cost if wrong: extra reminders.

**Parked after the final review (minor):**
19. A resume of a post that looks stuck can repeat one message if a job starts or stalls more than 6 minutes late. Fix: claim the post with a write at job start.
20. A job error can show raw database error text in the post's error line. No secrets are involved.
21. An edit blocked by a cancelled request labels the posted post `failed`. Delete still works.
22. After a cancel, or once a request is done, posted messages can only be deleted, not edited. For example, you can't edit the announcement to say "called off".

## Manual checks still to do
- **The whole flow on a throwaway Discord server** with three webhooks, a ping role and a bot (Manage Events):
  - test send: staff channel only, no ping, no event
  - post the announcement: one ping, event card last
  - edit it: no ping, same message ids
  - team notice, then disaster and resolve
  - delete
- **Sign-in checks:** sign in with a non-allowlisted Discord account and see your Discord ID on the login page; sign in normally and the cookie is cleared.
- **Browser views:** the Messages, Fallback, Prep, Event day and Questions tabs, the settings page as a manager (secrets masked), and the accept dialog.

## Known limits
- The tool-list budget has about 20 bytes of headroom, so the next MCP tool needs a budget decision.
- Request pages don't refresh live when only the request changes; they refresh after your own changes.
