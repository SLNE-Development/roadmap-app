# Part 7 (GitHub App): report

Branch `feat/v2`. Part 7 commits:
- 41566e8, bd86d44, 88da625, fb795d2 (7.1–7.4)
- ff23641, 50593f5, 2450d58, 2601bd1, 02aee2c, e7ab9e0 (7.10, 7.5, 7.6, 7.9, 7.7, 7.8)
- c359363 (was ba4de10 before a later rebase), the final-review fix commit

Part 8's first commits are interleaved after e7ab9e0 because parts overlapped. Gate green at e7ab9e0: lint, typecheck, 1077 tests, 38 plugin tests, 14 Valkey integration tests, build, build:worker. After the fix commit the full suite passes, apart from one in-progress Part 8 test that wasn't Part 7 code: 1176 tests. Migration 0027. New dependencies: `@octokit/app`, `@octokit/request`, `@octokit/core`, `@octokit/plugin-paginate-rest`.

Three small commits during your testing sit in this range too:
- `2346b6e`: mentions accept Better Auth user ids.
- `0579e46`: each test push gets its own tag.
- `d6d60fe`: the account menu is grouped, with the theme in a submenu.

## Tasks done
All 10 tasks are done and each passed review:
1. Schema and encrypted app credentials
2. GitHub API wrapper and test fake
3. Webhook routes, signatures and deliveries
4. Admin → GitHub App page with manifest and install flows
5. Installation events, repo picker and repo links
6. Reference parsing and code links
7. Owner rules, checks and notifications
8. Code panel on systems, PR chips, board marker, `pr-open`/`pr-merged` gate rules, `get_system` code
9. Personal GitHub login (account menu → Connections)
10. Docs, plugin skill reference syntax, README GitHub section

These needed fix rounds:
- **7.4:** `repo_count` was never written, so "Repos visible" always read 0. It is now filled from GitHub (ruling). Other fixes in the same round:
  - error-toast lookup by own key
  - sign-in keeps GitHub's callback parameters
  - install requests deduped per day
- **7.5:** one failing installation broke the whole repo picker and linking. Failing installations are now skipped. Also:
  - the cold-cache double fetch is gone
  - linked items keep the private/public pill
  - the account login is no longer overwritten with ""
- **7.8:** saving column rules silently dropped an existing PR gate when the picker hid it. It now stays listed and is kept.
- **7.9:** the "is GitHub set up?" query decrypted every app secret on each page load. It is now a cheap existence check. A GitHub `?error` on the OAuth callback now gives the right message.
- **7.10:** the README claimed PR events only arrive through the App, and it lacked the three rules. I fixed both.

The Opus final review found three important problems, fixed in c359363:
- **Reinstalling the App stranded linked repos, and check_suite deliveries failed on every retry.** One `adoptRepos` helper now re-attaches repos from `installation.created`, `repositories_added` and the setup return. Repos with lost access are ignored for checks.
- **"Create GitHub App" from localhost failed at GitHub.** The admin page now detects a non-public site URL, explains it and disables the button. The server refuses as well.
- **App deliveries for a repo linked by hand were processed twice.** App deliveries now ignore webhook-mode repos.

The same commit also:
- **Webhook route:**
  - streams the webhook body with a 5 MB cap instead of buffering it
  - verifies the HMAC over the raw bytes
- **Notifications:**
  - notifies the task owner when automation can't close a task
  - stops notifying someone about their own merge, and names the actor
- **Data and settings:**
  - widens `INVALIDATES.github`
  - stores only `https://github.com/` URLs on code links
  - clears the previous webhook secret when credentials are saved again
- **Tests and wording:**
  - test users now get Better-Auth-style ids, the same id-format gap that hid the mention bug
  - adds missing Review Focus tests
  - fixes README wording

## Deviations from the plan
- **Job registration** goes through `src/worker/consumers/index.ts`, the repo's registration list, not `src/worker/jobs.ts`.
- **Failed enqueue:** if a delivery can't be queued, the webhook route deletes its `github_delivery` row and answers 503, so GitHub's redelivery isn't swallowed by dedupe.
- **Delivery ids** must be UUIDs and are checked after the signature. `github.event` retries 3 times with exponential backoff from 10 s.
- **New notification kinds** go in `src/lib/notification-kinds.ts`, `PUSH_BY_DEFAULT` and `KIND_LABELS`, where Part 6 split those constants.
- **Octokit** is loaded lazily with a dynamic `import()`. The packages are ESM-only and the dev worker loads code through `require`.
- **`gates.rules`** takes `{ project, include? }`, so a rule a column already has is never hidden.
- **Personal login** is unlinked through `github.unlinkAccount`, because `github.unlink` was taken by repos. `github.account` returns `{ configured, account }`.
- **The admin page** disables "Create GitHub App" when the site URL isn't public.

## Decisions I made (rulings)
1. Ruling: job modules register through src/worker/consumers/index.ts — the repo's registration list — cost if wrong: none.
2. Ruling: github.event jobId = delivery GUID, validated, retries via JobOptions { attempts: 3, backoffMs: 10_000 } — cost if wrong: none.
3. Ruling: the webhook route deletes its github_delivery row and answers 503 when enqueue fails — otherwise GitHub's redelivery hits dedupe and the event is lost — cost if wrong: none.
4. Ruling: github.prune-deliveries runs daily with tz "UTC" (04:15) — cost if wrong: none.
5. Ruling: new notification kinds go in notification-kinds.ts, PUSH_BY_DEFAULT and KIND_LABELS — Part 6 split the constants — cost if wrong: none.
6. Ruling: recordInstallation fills repo_count from listInstallationRepos and seeds the Kv repo cache — the plan declares and reads repo_count but never writes it — cost if wrong: one extra GitHub call per install return.
7. Ruling: 7.6 and 7.10 ran in parallel with 7.5; 7.6 didn't touch the shared consumers index (the controller added its import) — cost if wrong: one follow-up line.
8. Ruling (your feedback): implementers, fix rounds and task reviews run on Sonnet; Opus only for final whole-part reviews.

## Things you should know
- **Usage limit incident.** The weekly usage limit stopped two agents mid-work: the 7.5 implementer and a worker fixer. The fixer left `node_modules` damaged (`bullmq` missing).
  - I stopped our node processes and ran `npm ci` from the unchanged lockfile.
  - I saved 7.5's partial work in a stash and resumed it later.
  - I finished the worker fix myself.

  Nothing was lost.
- **Dev setup.** At your request I started a dev Valkey container (`roadmap-v2-dev-valkey` on port 6380, `VALKEY_URL` added to `.env`) and the dev server on :3001 with the worker. The app migrated your dev database on startup, as it always does.
- **Local GitHub testing.** Creating the GitHub App locally isn't possible, because GitHub needs a public URL. Use a tunnel as `BETTER_AUTH_URL`, or "Use an existing app".
- **Trailers.** Every Part 7 commit carries the Opus trailer.

## Parked minor findings
- `exchangeOAuthCode`, `listFailedDeliveries` and `updateWebhookSecret` have no unit tests.
- `getGitHubApi` builds a new App per job (one token mint per delivery).
- The pulls/rules/checks modules import each other (type-only on one side).
- `code_link` author names are matched by login. A renamed login can be attributed wrongly; storing the GitHub id would fix it.
- The overview cap of 20 links can hide older task PR chips.
- A `checks.failed` notice is sent once per commit, even if checks fail again on a re-run.

## Manual checks still to do (need sign-in, a public URL or a real GitHub App)
- **7.4:** `/admin/github`: the not-set-up page on localhost shows the "can't reach" note. With a public URL, create the App, install it, rotate the secret and check the health panel.
- **7.5:** project Settings → GitHub:
  - picker groups and pills
  - linking through the App
  - adding a repo by hand (payload URL and secret)
  - rule switches
  - unlink
- **7.6–7.7:** a real PR with `[roadmap#<id>]` in the title links, merging closes the task (rule on), opening moves the system to review, failing checks warn.
- **7.8:** the Code panel, task PR chip and board marker in light and dark; PR gate rules in the column-rules dialog.
- **7.9:** account menu → Connections: link and unlink your GitHub login.
