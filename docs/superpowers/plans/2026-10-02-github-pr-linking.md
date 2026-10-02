# GitHub PR Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four GitHub improvements:
- The App can be installed on more than one account.
- The project create and edit forms pick the repository from the same combobox as the GitHub settings.
- A `/roadmap` comment on a PR links it to a task.
- The App answers every linked PR with one sticky comment.

**Architecture:**
- GitHub calls stay behind `GitHubApi` (`src/lib/github/api.ts`, faked by `fakeGitHubApi`). It gains PR, comment and app-permission methods.
- A link made by `/roadmap` or by the picker page never lands in the database directly. The App appends the ref (`roadmap#188` or `roadmap:slug`) to the PR body, or to the title when the task should close on merge. GitHub then sends `pull_request.edited`, and the existing handler in `src/worker/github/pulls.ts` stores the link, so title and body stay the single source of truth.
- `syncPrComment` (`src/worker/github/pr-comment.ts`) keeps one marked App comment per PR. It lists the current links and is edited in place.

**Tech Stack:**
- Next.js app router, tRPC, drizzle on Postgres (PGlite in tests), BullMQ worker, vitest.
- `@octokit/app` for GitHub calls.
- next-intl messages in `messages/{en,de}/*.json`.
- shadcn/ui (`command`, `popover`, `native-select`, `checkbox`).

**Spec:** none. The design was agreed in chat on 2026-10-02. Its decisions:
- `/roadmap` gets a picker-page link.
- Refs are appended to the PR body.
- One sticky comment per PR.
- The create dialog fills the URL and links the repo after the project is created.

## Global Constraints

- One task, one commit, Conventional Commits in English: `type(scope): lowercase description`. Scope is `github` unless stated. End every commit with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Never push.
- Business logic goes in `src/lib/ops/*.ts`: functions take `(db, …, actor, …)`, and permission checks go through `projectAccess` / `linkerAccess`. Routes and components only call ops.
- Tests never hit the network. Use `fakeGitHubApi()`, `createTestDb()` and the fixtures in `src/test/fixtures.ts`. Worker handlers are tested the way `src/worker/github/pulls.test.ts` does it (`deliver(db, event, payload)` through `handleGitHubEvent` with `getApi`).
- Every user-facing string goes in both `messages/en/*.json` and `messages/de/*.json` (German: informal "du", as in the existing files).
- Match the surrounding code: JSDoc on every export, the existing naming, no new dependencies.
- The ref grammar is unchanged:
  - `roadmap#<taskId>` (task) and `roadmap:<system-slug>` (system), parsed by `parseRefs` in `src/lib/github/refs.ts`.
  - Title refs close the task on merge (`closes: true`); body refs don't.
- Roadmap URLs come from `siteUrl()` (`src/lib/site.ts`):
  - task: `/p/<projectSlug>/systems/<systemSlug>#task-<id>`
  - system: `/p/<projectSlug>/systems/<systemSlug>`
  - picker: `/p/<projectSlug>/link-pr?repo=<githubRepo.id>&pr=<number>`
- Only repos with `mode === "app"`, a non-null `installationId` and `access === "ok"` ever get GitHub write calls (comments, PR edits).
- Before each commit run `npx tsc --noEmit`, `npx eslint <touched files>` and `npx vitest run <touched test files>`. All must pass.

## Review Focus

1. **The App's own activity must not loop.**
   - Its comment arrives as `issue_comment.created` with `comment.user.type === "Bot"` or `comment.performed_via_github_app` set: ignore it with no API calls.
   - Its body edit arrives as `pull_request.edited`: re-sync without a second comment, and skip `updateComment` when the body is unchanged.
   - Pinned in Tasks 3 and 4.
2. **A stranger on a public repo comments `/roadmap`.** Ignore it when `author_association` is NONE, FIRST_TIMER, FIRST_TIME_CONTRIBUTOR or CONTRIBUTOR and the commenter is not the PR author. Status `ignored`, detail `not allowed`, zero API calls. Pinned in Task 4.
3. **An installation hasn't accepted the new `pull_requests: write` permission.** GitHub then answers 403 on comment or PR edit. Links are still stored, the delivery ends `done` with the note `comment skipped: GitHub refused (403)`, and nothing is thrown, so nothing retries. Pinned in Task 3.
4. **A PR in a repo linked by hand (webhook mode) or with lost access:** no GitHub write calls at all, and links are stored as before. Pinned in Task 3.
5. **`linkPullRequest` misuse:**
   - A viewer gets ForbiddenError.
   - A repo id of another project gets NotFoundError.
   - A ref already present anywhere in title or body leads to no `updatePullRequest` call and the answer `{ changed: false }`.
   - Pinned in Task 5.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/github/api.ts` | + `getPullRequest`, `updatePullRequest`, `findComment`, `createComment`, `updateComment`, `getAppPermissions` |
| `src/lib/github/fake.ts` | the same methods, in memory |
| `src/lib/github/manifest.ts` | `public: true`, `pull_requests: "write"`, event `issue_comment`, `REQUIRED_PERMISSIONS`, `REQUIRED_EVENTS` |
| `src/lib/github/pr-text.ts` (new) | `withRef` (pure): where a ref goes in a PR title/body |
| `src/lib/github/command.ts` (new) | `parseRoadmapCommand` (pure) |
| `src/worker/github/pr-comment.ts` (new) | `renderPrComment` (pure) and `syncPrComment` |
| `src/worker/github/pulls.ts` | call `syncPrComment` after links change |
| `src/worker/github/comments.ts` (new) | `issue_comment` handler for `/roadmap` |
| `src/lib/ops/github-pr.ts` (new) | `pullRequestLinkContext`, `linkPullRequest`, `searchOpenTasks` |
| `src/lib/ops/github-repos.ts` | + `pickableRepos` |
| `src/lib/ops/github-app.ts` | `AppHealth.missing` |
| `src/server/trpc/routers/github.ts` | + `pickableRepos`, `pullRequestContext`, `linkPullRequest` |
| `src/components/github/repo-combobox.tsx` (new) | presentational repo combobox |
| `src/components/github/repo-picker.tsx` | uses `RepoCombobox` |
| `src/components/github/repo-field.tsx` (new) | form field: combobox or URL input |
| `src/components/new-project-dialog.tsx`, `src/components/project-settings.tsx` | use `RepoField` |
| `src/app/(app)/p/[project]/link-pr/page.tsx` + `link-pr-view.tsx` (new) | picker page |
| `src/app/(app)/(global)/admin/github/github-admin-view.tsx` | public-App note and missing-permission warning |
| `src/worker/index.ts` (or wherever `./github/pulls` is imported for side effects) | import `./github/comments` |

## Execution order

- **Wave A (parallel):** Task 1 and Task 2 share no files.
- **Wave B (parallel, after Wave A is merged):** Tasks 3, 5, 6 and 8. Task 5 edits `routers/github.ts` and `messages/*/integrations.json`, which Task 2 also edits, so Task 5 must start from the merged Wave A.
- **Wave C:** Task 4 needs Task 3's `syncPrComment` and Task 5's `searchOpenTasks`. Task 7 runs next to it (it touches `github-repos.ts`, `api.ts`, `fake.ts`, the combobox and `integrations.json`; Task 4 touches only worker files).

---

### Task 1: GitHub API surface, manifest and PR text helpers

**Files:**
- Modify: `src/lib/github/api.ts`, `src/lib/github/fake.ts`, `src/lib/github/manifest.ts`
- Create: `src/lib/github/pr-text.ts`, `src/lib/github/pr-text.test.ts`, `src/lib/github/command.ts`, `src/lib/github/command.test.ts`
- Test: `src/lib/github/api.test.ts`, `src/lib/github/manifest.test.ts`

**Interfaces (Produces):**

```ts
// api.ts
export interface PullRequestInfo { title: string; body: string; state: "open" | "closed"; merged: boolean; htmlUrl: string }
export interface CommentInfo { id: number; body: string }
export interface AppPermissions { permissions: Record<string, string>; events: string[] }
// added to GitHubApi:
getPullRequest(installationId: number, fullName: string, number: number): Promise<PullRequestInfo | null>; // null on 404
updatePullRequest(installationId: number, fullName: string, number: number, patch: { title?: string; body?: string }): Promise<void>;
/** The first comment on the issue/PR whose body contains `marker`, or null. */
findComment(installationId: number, fullName: string, number: number, marker: string): Promise<CommentInfo | null>;
createComment(installationId: number, fullName: string, number: number, body: string): Promise<CommentInfo>;
updateComment(installationId: number, fullName: string, commentId: number, body: string): Promise<void>;
getAppPermissions(): Promise<AppPermissions>;

// manifest.ts
export const REQUIRED_PERMISSIONS: Record<string, "read" | "write">; // { metadata: "read", contents: "read", pull_requests: "write", checks: "read" }
export const REQUIRED_EVENTS: string[]; // ["pull_request", "push", "check_suite", "issue_comment"]

// pr-text.ts
/** The PR fields to write so `ref` appears in it, or null when the ref is already in the title or body (case-insensitive). */
export function withRef(pr: { title: string; body: string }, ref: string, closes: boolean): { title?: string; body?: string } | null;
export const ROADMAP_LINE = "Roadmap:";

// command.ts
/** `{ query }` when the comment's first non-blank line is `/roadmap` optionally followed by text; else null. */
export function parseRoadmapCommand(body: string): { query: string } | null;
```

**Directions:**
- `octokitGitHubApi`: every new PR/comment method uses `(await requireApp()).getInstallationOctokit(installationId)` and `splitFullName`, like `listCheckSuites`.
  - `getPullRequest`: `GET /repos/{owner}/{repo}/pulls/{pull_number}`. Map `body ?? ""` and `merged ?? false`. Return null on status 404, the same try/catch pattern as `getInstallation`.
  - `updatePullRequest`: `PATCH /repos/{owner}/{repo}/pulls/{pull_number}` with only the given fields.
  - `findComment`: paginate `GET /repos/{owner}/{repo}/issues/{issue_number}/comments` (per_page 100) and return the first whose body includes `marker`.
  - `createComment`: `POST …/issues/{issue_number}/comments`. `updateComment`: `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}`.
  - `getAppPermissions`: `GET /app` with the App JWT (`a.octokit.request`). Map `permissions ?? {}` and `events ?? []`.
- `fakeGitHubApi`:
  - New seed fields:
    - `pulls: Record<string, PullRequestInfo>` keyed `` `${fullName}#${number}` ``
    - `comments: Record<string, CommentInfo[]>` keyed the same
    - `appPermissions?: AppPermissions`, defaulting to `REQUIRED_PERMISSIONS` / `REQUIRED_EVENTS`
    - `failWith?: Partial<Record<string, number>>`: method name → HTTP status. When set for a method, that method throws `Object.assign(new Error("fake GitHub: <status>"), { status })`. Tests use it for 403s.
  - Every method `record`s its call. `updatePullRequest` merges into the seed. `createComment` appends with ids counting from 1000. `updateComment` replaces the body.
- Manifest:
  - `public: true`, `default_permissions: REQUIRED_PERMISSIONS`, `default_events: REQUIRED_EVENTS`.
  - Update the doc comment: public means any account may install it, which is needed for installing on more than one account or organization.
  - Update `manifest.test.ts` expectations.
- `withRef`:
  - If `new RegExp(escape(ref) + "(?![\\w-])", "i")` already matches the title or body, return null.
  - With `closes`, return `{ title: `${title} ${ref}` }`.
  - Otherwise, when the body has a line that starts with `Roadmap:` (trimmed, case-sensitive), append ` ${ref}` to the first such line. Else append `\n\nRoadmap: ${ref}`, or just `Roadmap: ${ref}` when the body is blank. Return `{ body }`.
- `parseRoadmapCommand`:
  - Take the first line that isn't blank after trim. Match `/^\/roadmap(?:\s+(.+))?$/i` against it. Return `{ query: (m[1] ?? "").trim().slice(0, 200) }`.
  - `/roadmapper` and `please /roadmap` give null.

**Tests (input → expected):**
- `withRef({title:"Fix x", body:""}, "roadmap#5", false)` → `{ body: "Roadmap: roadmap#5" }`.
- `withRef({title:"Fix", body:"Text"}, "roadmap#5", false)` → `{ body: "Text\n\nRoadmap: roadmap#5" }`.
- `withRef({title:"Fix", body:"a\nRoadmap: roadmap#1\nb"}, "roadmap#5", false)` → body `"a\nRoadmap: roadmap#1 roadmap#5\nb"`.
- `withRef({title:"Fix", body:""}, "roadmap#5", true)` → `{ title: "Fix roadmap#5" }`.
- Already present: `withRef({title:"x ROADMAP#5", body:""}, "roadmap#5", false)` → null. `withRef({title:"x", body:"roadmap#55"}, "roadmap#5", false)` → not null, since `#55` isn't `#5`.
- `parseRoadmapCommand("/roadmap")` → `{query:""}`. `("\n  /Roadmap search index \nmore")` → `{query:"search index"}`. `("/roadmapper")`, `("hi /roadmap")` and `("")` → null.
- `api.test.ts`: with the existing stub-fetch pattern, each new method hits the right URL and method, and `getPullRequest` maps a 404 to null.

- [ ] Step 1: write the failing tests for `withRef`, `parseRoadmapCommand`, the manifest and the api methods; run `npx vitest run src/lib/github` and see them fail
- [ ] Step 2: implement; run again until green, then typecheck and lint
- [ ] Step 3: commit `feat(github): add pull request and comment calls to the github api`

---

### Task 2: Repo combobox in the project create and edit forms

**Files:**
- Create: `src/components/github/repo-combobox.tsx`, `src/components/github/repo-field.tsx`, `src/components/github/repo-field.test.tsx`
- Modify: `src/components/github/repo-picker.tsx`, `src/components/new-project-dialog.tsx`, `src/components/project-settings.tsx`, `src/lib/ops/github-repos.ts`, `src/server/trpc/routers/github.ts`, `messages/{en,de}/integrations.json`, `messages/{en,de}/home.json` / `settings.json` (only if new keys are needed there)
- Test: `src/lib/ops/github-repos.test.ts` (create it if missing, else extend it)

**Interfaces (Produces):**

```ts
// github-repos.ts
export interface PickableRepos { canLink: boolean; repos: AvailableRepo[] }
/** Repos the App can see, for forms without a project yet. `linked.here` is always false. canLink: an App is set up and (actor.isAdmin or linkPolicy !== "admins"). When !canLink, repos is []. */
export async function pickableRepos(db: Db, kv: Kv, api: GitHubApi, actor: Actor): Promise<PickableRepos>;
// router: github.pickableRepos: protectedProcedure.query(() => pickableRepos(ctx.db, ctx.kv, await getGitHubApi(ctx.db), ctx.actor))

// repo-combobox.tsx
export function RepoCombobox(props: {
  repos: UseQueryResult<AvailableRepo[]>;   // loading/error/data
  open: boolean; onOpenChange(open: boolean): void;
  onPick(repo: AvailableRepo): void;
  triggerText: string;          // placeholder or the picked fullName
  triggerMuted: boolean;        // true while showing a placeholder
  disabled?: boolean;
  footer?: React.ReactNode;     // rendered under a CommandSeparator
  onCloseAutoFocus?: (e: Event) => void;
}): JSX.Element;

// repo-field.tsx
/** The repository field of a project form: the App's repos as a combobox when the actor may link, else a URL input. */
export function RepoField(props: {
  id: string;
  value: string;                                   // the repoUrl text
  onChange(value: string, picked: string | null): void; // picked = fullName when chosen from the list, null when typed
  placeholder: string;
  describedBy?: string;
}): JSX.Element;
```

**Directions:**
- `pickableRepos`:
  - Factor out of `availableRepos` a private `appRepos(db, kv, api, actor, projectId: string | null)` that does the installation listing, the link lookup and the sorting. `availableRepos` keeps its exact behaviour and signature and calls it with `project.id`.
  - With `null`, no repo is `here`. The other-project name lookup via `projectAccessById` stays.
  - `canLink`: `await hasApp(db)` and (`actor.isAdmin` or `githubApp.linkPolicy !== "admins"`).
- `RepoCombobox`: move the Popover/Command markup from `RepoPicker` into it unchanged, with the same owner grouping, `linkedLabel` disabling, `Tag` and i18n keys under `integrations.picker`. `RepoPicker` keeps its public props and behaviour (link on pick, install-more and enter-by-hand footer) and renders `RepoCombobox`.
- `RepoField`:
  - It queries `trpc.github.pickableRepos` with `enabled: open || true`. The first render must decide combobox vs. input, so fetch on mount (`staleTime: 60_000`).
  - When the query is loading, errors, or `!canLink`, render a plain `<Input type="url">` like today.
  - Otherwise render a `RepoCombobox`. Its trigger shows `value` when it is a URL or a picked name, else the placeholder. Picking calls `onChange(`https://github.com/${fullName}`, fullName)`.
  - The footer has an "Enter URL by hand" button (`integrations.picker.enterUrlByHand`). It switches the field to the plain input and keeps the value. Typing calls `onChange(text, null)`.
- `NewProjectDialog`:
  - Replace the repo `Input` with `RepoField` and keep `pickedRepo: string | null` in state.
  - In the create mutation's `onSuccess`, when `pickedRepo` is set, call the vanilla client before `router.push`: `trpcClient.github.linkAppRepo.mutate({ project: created, repo: { fullName: pickedRepo } })`. Get the client through `useTRPCClient` from `@/trpc/client`, or the existing equivalent. It must not depend on the dialog staying mounted.
  - On error, `toast.error(t("repoLinkFailed", { name: pickedRepo }))`. The project stays created and the push still happens. English: `"The project was created, but {name} couldn't be linked. Link it under Settings → GitHub."`
- `GeneralForm`: same `RepoField`. On save success, when a repo was picked in this edit and the picked repo's `linked` was null, call `trpc.github.linkAppRepo` and toast `github.linked` on success, or the error message on failure. Invalidate `trpc.github.repos` for the project.
- The German strings go into the same keys in `messages/de/...`.

**Tests:**
- Ops (PGlite and `fakeGitHubApi` with one installation and two repos, one already linked to project Q):
  - Admin → `canLink: true`, 2 repos, with Q's repo `linked: { here: false, projectName: "q" }`.
  - Non-member user → the same repos, but Q's projectName is null.
  - Policy `admins` and a non-admin → `{ canLink: false, repos: [] }`.
  - No App row → `canLink: false`.
- `availableRepos` existing tests still pass unchanged.
- `repo-field.test.tsx` (copy the setup of an existing component test that mocks tRPC, see `src/test/trpc-mock.ts`):
  - `canLink: false` → a textbox with the placeholder is rendered.
  - `canLink: true` → a combobox trigger is rendered. Picking `org/app` calls `onChange("https://github.com/org/app", "org/app")`.
  - A repo linked elsewhere is disabled.

- [ ] Step 1: write the failing ops tests and the component test, then run them
- [ ] Step 2: implement the ops, the router, `RepoCombobox`, `RepoPicker`, `RepoField` and both forms; run until green, then typecheck and lint
- [ ] Step 3: commit `feat(github): pick the repository from the app's repos when creating or editing a project`

---

### Task 3: Sticky PR comment

**Files:**
- Create: `src/worker/github/pr-comment.ts`, `src/worker/github/pr-comment.test.ts`
- Modify: `src/worker/github/pulls.ts`, `src/worker/github/pulls.test.ts`

**Interfaces:**
- Consumes: Task 1's `GitHubApi.findComment/createComment/updateComment` and the fake's `failWith` and `comments`.
- Produces:

```ts
export const COMMENT_MARKER = "<!-- roadmap-app:links -->";
export interface CommentLink { ref: string; title: string; systemTitle: string | null; url: string; closes: boolean; done: boolean }
/** Pure: the comment body. Always starts with COMMENT_MARKER. */
export function renderPrComment(input: { links: CommentLink[]; notice: string | null; pickUrl: string }): string;
/**
 * Brings the App's comment on the PR in line with its stored links. Does nothing for repos that aren't App-linked
 * with access, and creates no comment when there are no links and no notice. Never throws for GitHub errors;
 * returns a note for the delivery detail instead (null when nothing worth noting happened).
 */
export async function syncPrComment(deps: WorkerDeps, api: GitHubApi, repo: GitHubRepoRow, number: number, notice?: string | null): Promise<string | null>;
```

**Directions:**
- Comments are in English only: GitHub content has no viewer locale.
- `renderPrComment` layout (markdown):
  1. The marker.
  2. Then either:
     - with links: `**Linked on the roadmap**` and one bullet per link, `- [<title>](<url>) · \`<ref>\`` plus ` · <systemTitle>` for tasks, ` · closes on merge` when `closes`, and ` · ✓ done` when `done`;
     - with no links: `_This pull request is no longer linked to the roadmap._`.
  3. A blank line and the `notice` when it is set.
  4. A footer line: `<sub>Comment \`/roadmap\` to link a task, or [pick one on the roadmap](<pickUrl>).</sub>`
- `syncPrComment`:
  - Return null right away unless `repo.mode === "app" && repo.installationId !== null && repo.access === "ok"`.
  - Load this PR's `codeLink` rows (`repoId = repo.id`, `refKey = refKeyOf({ kind: "pr", number, sha: null })`), left-joined to `task` and joined to `system` and `project` for titles and slugs. Build `CommentLink`s:
    - Task links: ref `roadmap#<taskId>`, title = the task title, done = `task.state === "done"`.
    - System links: ref `roadmap:<slug>`, title = the system title, systemTitle null.
    - Sort tasks first, then by ref.
  - Build `pickUrl` from `siteUrl()`.
  - Call `api.findComment(..., COMMENT_MARKER)`.
    - None found: when `links.length === 0 && !notice`, return null; otherwise `createComment`.
    - Found: when the body equals the rendered body, return null; otherwise `updateComment`.
  - Wrap the GitHub calls in try/catch. When the error has a numeric `status`, return `comment skipped: GitHub refused (<status>)`; otherwise `comment skipped: <message, cut to 120>`. Log with `console.error` too.
- `pulls.ts`:
  - The edited-delete must report how many rows it removed: add `.returning({ id: codeLink.id })` and carry `removed` out of the transaction next to `stored`.
  - After `runPullRequestRules`, when `stored.some((l) => l.created) || removed > 0 || (action === "opened" && stored.length > 0)`, call `syncPrComment(deps, api, repo, pr.number)` and push a non-null note into `notes` before the detail is joined.
  - Change nothing else in the handler.

**Tests:**
- `renderPrComment`:
  - Two links (a task with closes, a system) → contains the marker, both bullets in task-first order, `closes on merge` once, and the footer with the pickUrl.
  - No links → contains `no longer linked`.
  - A notice is rendered.
- `pulls.test.ts` additions (reuse `setup()`; the repo there is app-mode, so give it `installationId` and access "ok" if `setup` doesn't already):
  - `opened` with title `roadmap#<t1>` → one `createComment` call whose body contains `roadmap#<t1>`.
  - The same delivery again as `edited` with the same title → no `createComment` and no `updateComment` (body equal).
  - `edited` removing the ref → one `updateComment` with `no longer linked`.
  - `opened` without refs → no comment calls.
  - With `failWith: { createComment: 403 }` → status `done`, and the detail contains `comment skipped: GitHub refused (403)`. The code link is still stored.
  - A repo in webhook mode (source `repo` delivery) → no `findComment` call.

- [ ] Step 1: write the failing tests, then run `npx vitest run src/worker/github`
- [ ] Step 2: implement `pr-comment.ts` and the `pulls.ts` hook; run until green, then typecheck and lint
- [ ] Step 3: commit `feat(github): answer linked pull requests with one roadmap comment`

---

### Task 4: `/roadmap` comment command

**Files:**
- Create: `src/worker/github/comments.ts`, `src/worker/github/comments.test.ts`
- Modify: the worker entry that imports `./github/pulls` for its side effect (find it with `grep -rn "github/pulls\"" src/worker`): add `import "./github/comments"` next to it

**Interfaces:**
- Consumes:
  - `parseRoadmapCommand`, `withRef` (Task 1)
  - `syncPrComment`, `COMMENT_MARKER` (Task 3)
  - `searchOpenTasks` (Task 5)
  - `findRepo`, `handBlocked` (`pulls.ts`)
  - `resolveRefs` (`github-links.ts`), `parseRefs`
- Produces: the `issue_comment` handler registered with `onGitHubEvent("issue_comment", …)`.

**Directions:**
- The payload parts read: `action`, `repository`, `issue: { number, pull_request?: object, user?: { id } }`, `comment: { body, author_association, user?: { id, type }, performed_via_github_app?: object | null }`.
- Gate in this order. Each gate returns `{ status: "ignored", detail }` and makes no API call:
  1. `action !== "created"` → `issue_comment.<action>`.
  2. No `issue.pull_request` → `not a pull request`.
  3. `parseRoadmapCommand(comment.body)` is null → `no command`.
  4. `comment.user?.type === "Bot"` or `comment.performed_via_github_app` → `bot comment`.
  5. Commenter not trusted → `not allowed`. Trusted means `author_association` is in `OWNER`, `MEMBER` or `COLLABORATOR`, or `comment.user.id === issue.user.id`.
  6. `findRepo` is null → the `NOT_LINKED` outcome. Export `NOT_LINKED` from `pulls.ts`, or rebuild the same literal.
  7. `handBlocked` → its outcome.
  8. Repo not App-linked with access (see the Global Constraints) → `repository not linked through the app`.
- With an empty query: `syncPrComment(deps, api, repo, n, "Pick the task for this pull request: [open the roadmap picker](<pickUrl>).")` → status `done`, detail `picker offered` plus the sync note if any. Build `pickUrl` the same way as in Task 3; export a helper `pickUrlOf(projectSlug, repoId, number)` from `pr-comment.ts` and use it in both places.
- With a query:
  - **Refs in the query** (`parseRefs(query)` finds tasks or systems): resolve them in the repo's project with `resolveRefs`.
    - Collect the resolved refs as strings (tasks `roadmap#<id>`, systems `roadmap:<slug>`).
    - Unresolved ones go into a notice: `` `roadmap#999` isn't a task or system of this project. ``
  - **Otherwise:** `searchOpenTasks(deps.db, repo.projectId, query, 6)`.
    - Exactly 1 hit → that task's ref.
    - 0 hits → notice ``No open task matches "<query>". [Pick one on the roadmap](<pickUrl>).``
    - 2–6 hits → notice `Several tasks match "<query>":` with one `` - `roadmap#<id>` <title> · <systemTitle> `` line each (at most 5), then `Comment \`/roadmap roadmap#<id>\` or [pick one on the roadmap](<pickUrl>).`
  - **When there are refs to add:**
    - `api.getPullRequest(...)`; if it returns null → status `done`, detail `pull request not found`.
    - Fold every ref with `withRef(current, ref, false)`, applying each result onto `current`.
    - When something changed, call `api.updatePullRequest` once with the final body. The PR edit webhook then links and syncs the comment, so don't sync here unless there is also a notice.
    - Detail: `added <n> refs`.
  - **When there is a notice:** `syncPrComment(..., notice)`.
  - The same try/catch-to-note rule as Task 3 applies to `getPullRequest` / `updatePullRequest`.
- `searchOpenTasks` is defined in Task 5 (`src/lib/ops/github-pr.ts`). Task 4 runs after Task 5, so import it from there.

**Tests (fake API, a PR `Org/App#7` seeded in `pulls`):**
- `/roadmap` by OWNER → one `createComment` whose body contains `/p/p/link-pr?repo=` and `pr=7`.
- `/roadmap Results` (unique title match) → one `updatePullRequest` with body ending `Roadmap: roadmap#<t1>`, and no comment call.
- `/roadmap roadmap#<t1>` when the body already has it → no `updatePullRequest`.
- `/roadmap roadmap#<q1>` (a task of another project) → no `updatePullRequest`; the comment notice says it isn't a task of this project, without mentioning Q's task title.
- `/roadmap e` matching both tasks → a comment listing both refs.
- Association `NONE` and not the author → `ignored` / `not allowed`, `api.calls` empty.
- Association `NONE` but `comment.user.id === issue.user.id` → handled.
- `user.type: "Bot"` → `ignored` / `bot comment`.
- An issue without `pull_request` → `ignored`.
- `failWith: { updatePullRequest: 403 }` → status `done`, detail with `GitHub refused (403)`.

- [ ] Step 1: write the failing tests, then run them
- [ ] Step 2: implement and register the handler; run until green, then typecheck and lint
- [ ] Step 3: commit `feat(github): link pull requests to tasks with a /roadmap comment`

---

### Task 5: PR link picker page

**Files:**
- Create: `src/lib/ops/github-pr.ts`, `src/lib/ops/github-pr.test.ts`, `src/app/(app)/p/[project]/link-pr/page.tsx`, `src/app/(app)/p/[project]/link-pr/link-pr-view.tsx`
- Modify: `src/server/trpc/routers/github.ts`, `messages/{en,de}/integrations.json`

**Interfaces (Produces):**

```ts
// github-pr.ts
export const linkPullRequestInput = z.object({
  repoId: z.string().min(1),
  number: z.number().int().positive(),
  target: z.union([z.object({ taskId: z.number().int().positive() }), z.object({ systemSlug: z.string().min(1).max(64) })]),
  closes: z.boolean().default(false),
});
export interface PrLinkContext {
  repo: { id: string; fullName: string };
  pr: { number: number; title: string; state: "open" | "closed"; merged: boolean; url: string };
  linked: { tasks: number[]; systems: string[] };           // parseRefs(title + "\n" + body)
  systems: { slug: string; title: string; tasks: { id: number; title: string; state: string }[] }[]; // non-archived systems by title; tasks not done, by sortOrder
}
/** Editor or higher. NotFoundError for an unknown PR or a repo outside the project; ConflictError when the repo isn't App-linked with access. */
export async function pullRequestLinkContext(db: Db, api: GitHubApi, actor: Actor, projectSlug: string, repoId: string, number: number): Promise<PrLinkContext>;
/** Editor or higher. Adds the target's ref to the PR via withRef; { changed: false } when it's already there. Same errors, plus NotFoundError for a task/system not in the project. */
export async function linkPullRequest(db: Db, api: GitHubApi, actor: Actor, projectSlug: string, raw: z.input<typeof linkPullRequestInput>): Promise<{ changed: boolean; ref: string }>;
/** Open (not done) tasks of the project's non-archived systems whose title contains `query` (case-insensitive), by title, at most `limit`. */
export async function searchOpenTasks(db: Executor, projectId: string, query: string, limit: number): Promise<{ id: number; title: string; systemTitle: string; systemSlug: string }[]>;
// router (github): pullRequestContext query { project, repoId, number }; linkPullRequest mutation { project, ...linkPullRequestInput.shape }
```

**Directions:**
- Access is `projectAccess(db, actor, slug, "editor")`. Load the `githubRepo` by id and require `projectId === project.id`, else NotFoundError(`Unknown repository.`). Require app mode, an installation and access ok, else ConflictError(`This repository isn't linked through the GitHub App.`). `getPullRequest` null → NotFoundError(`Unknown pull request.`).
- `linkPullRequest`:
  - Resolve the target inside the project. For a task, the task joined to a non-archived system of the project. For a system, slug + projectId, non-archived.
  - Ref `roadmap#<id>` or `roadmap:<slug>`.
  - `withRef(pr, ref, closes)`: null → `{ changed: false, ref }`, else `updatePullRequest` → `{ changed: true, ref }`.
  - `searchOpenTasks` uses `ilike` with `%` and `_` escaped in the query.
- `page.tsx`:
  - Server component. Read `searchParams.repo` and `searchParams.pr` (Next 15+: `await searchParams`).
  - Invalid or missing values render the project's not-found UI (`notFound()`).
  - Prefetch `trpc.github.pullRequestContext` the way `settings/github/page.tsx` prefetches, and render `LinkPrView`. Copy the auth and frame pattern of a sibling page.
- `LinkPrView` (client, `useSuspenseQuery`), top to bottom:
  1. `PageHeader` titled `t("linkPr.title")`, e.g. "Link pull request".
  2. A panel with `<fullName>#<number> <title>`, linked to the PR on GitHub, plus a state tag.
  3. The current links as chips; task ids are shown with their titles where `systems` knows them.
  4. A `NativeSelect` of systems, plus a `Command` list (search input) of that system's open tasks. The first entry is "The whole system" (`target: { systemSlug }`).
  5. A `Checkbox` "Close the task when this PR is merged (adds the ref to the title)", disabled for whole-system targets.
  6. The Link button.
- On success:
  - `changed` → `toast.success(t("linkPr.added", { ref }))`, English: `"Added {ref} to the pull request. GitHub will update it in a moment."`
  - Otherwise `t("linkPr.already", { ref })`.
  - Then invalidate the context query. Errors toast their message.
- Every string goes in `integrations.linkPr.*` in en and de.

**Tests (`github-pr.test.ts`, PGlite + fake API):**
- Context for an editor lists the system with t1 and t2, without done tasks or archived systems, and `linked` parsed from a seeded PR body `roadmap#<t1>`.
- A viewer → ForbiddenError.
- A repo id of project Q while acting in P → NotFoundError.
- A webhook-mode repo → ConflictError.
- `linkPullRequest` with `{ taskId: t2 }` → one `updatePullRequest` call whose body contains `Roadmap: roadmap#<t2>`; answers `{ changed: true }`.
- With `closes: true` → the title is updated instead.
- Linking again → `{ changed: false }`, no new call.
- A task of project Q → NotFoundError.
- `searchOpenTasks("res")` → [Results]. `"%"` → []. A done task is excluded.

- [ ] Step 1: write the failing ops tests, then run them
- [ ] Step 2: implement the ops, router, page and view; run until green, then typecheck and lint
- [ ] Step 3: commit `feat(github): pick the task for a pull request on the roadmap`

---

### Task 6: Admin page: public App and missing permissions

**Files:**
- Modify: `src/lib/ops/github-app.ts` (`appHealth`), `src/app/(app)/(global)/admin/github/github-admin-view.tsx`, `messages/{en,de}/admin.json`
- Test: the existing `appHealth` tests (find them with `grep -rln "appHealth" src --include=*.test.ts`)

**Interfaces:**
- `AppHealth` gains `missing: string[]`. Entries look like `pull_requests: write` and `event issue_comment`.

**Directions:**
- In `appHealth`, add `api.getAppPermissions()` to the `Promise.all`.
  - Missing permissions: every `REQUIRED_PERMISSIONS` entry where the App's level is absent or lower (`read` < `write`), formatted `<name>: <level>`.
  - Missing events: every `REQUIRED_EVENTS` entry not in `events`, formatted `event <name>`.
  - If `getAppPermissions` throws, `missing` is `[]` and the error is logged. The health panel must not break.
- Admin view, settings panel:
  - Replace `permissionsHint` with: "Metadata, contents and checks read; pull requests read and write (to comment and add roadmap refs). Events: pull requests, pushes, check suites and comments."
  - When `health.data.missing.length > 0`, show a warning box (`text-destructive`) with `t("missingPermissions", { list })`: "The App on GitHub lacks {list}. Add them under the App's settings → Permissions & events, then accept the new permissions on every installation." Link to the App's `htmlUrl` settings if `app` exposes it; check `AppSummary`.
  - Below the installations' install button, add a muted hint `t("installOtherAccounts")`: "To install on other accounts or organizations, the App must be public: App settings → Advanced → Make public."
- Write the German versions in the same keys.

**Tests:**
- `appHealth` with the fake's default permissions → `missing: []`.
- With `appPermissions: { permissions: { pull_requests: "read", metadata: "read", contents: "read", checks: "read" }, events: ["pull_request","push","check_suite"] }` → `["pull_requests: write", "event issue_comment"]`.
- With `failWith: { getAppPermissions: 500 }` → `missing: []`, and the other fields are still returned.

- [ ] Step 1: write the failing tests, then run them
- [ ] Step 2: implement and update the view and messages; run until green, then typecheck and lint
- [ ] Step 3: commit `feat(github): warn admins about missing app permissions`

---

### Task 7: Picker only shows repos the person can see on GitHub

The user asked for this on 2026-10-02, after the plan was written. Decisions:
- With no linked GitHub account, the picker shows public repos only, plus a hint to link one.
- Admins are filtered like everyone else.

**Files:**
- Modify: `src/lib/github/api.ts`, `src/lib/github/fake.ts`, `src/lib/github/api.test.ts`, `src/lib/ops/github-repos.ts`, `src/lib/ops/github-repos.test.ts`, `src/components/github/repo-combobox.tsx`, `src/server/trpc/routers/github.ts` (only if a response shape changes), `messages/{en,de}/integrations.json`

**Interfaces (Produces):**

```ts
// GitHubApi
/** Whether the GitHub user `login` can read the repo: GET /repos/{owner}/{repo}/collaborators/{username}/permission through the installation; permission "none" or a 404 → false. */
canUserReadRepo(installationId: number, fullName: string, login: string): Promise<boolean>;
// fake seed: readers?: Record<string, string[]>  // fullName → logins that can read it; default none
// github-repos.ts
export interface PickerRepos { repos: AvailableRepo[]; githubLinked: boolean } // returned by availableRepos (was AvailableRepo[])
// PickableRepos gains githubLinked: boolean
```

**Directions:**
- Add a private `visibleTo(db, kv, api, actor, found: { repo: RepoInfo; installationId: number }[])` in `github-repos.ts`.
  - It loads the actor's `githubAccount` row.
  - Public repos (`!repo.private`) always stay in.
  - With no linked account, private repos are dropped.
  - Otherwise each private repo is checked with `api.canUserReadRepo(installationId, fullName, account.login)`, cached in Kv under `gh:read:<githubRepoId>:<githubId>` (value `"1"`/`"0"`, TTL `REPO_CACHE_TTL`), at most 8 GitHub calls in flight.
  - A GitHub error for one repo is logged and the repo is dropped (fail closed). Kv read/write errors are logged and ignored, like `cachedRepos`.
- The shared repo listing that `availableRepos` and `pickableRepos` use (the `appRepos` helper Task 2 introduced) filters through `visibleTo` before the link lookup.
- `availableRepos` now returns `{ repos, githubLinked }`; update `RepoPicker` and its tests to match. `pickableRepos` adds `githubLinked`.
- `linkAppRepo` must enforce the same rule, so a hidden repo can't be linked by typing its name. After `findAppRepo` succeeds, when the repo is private and `visibleTo` drops it, throw the same InvalidError as for a repo the App can't see. Don't reveal that it exists.
- Clear the cached answers when someone links or unlinks their GitHub account? Not needed: the key includes `githubId`, so a new account gets new keys.
- `RepoCombobox`: when `githubLinked` is false, the footer shows `integrations.picker.linkGitHubHint` ("Link your GitHub account to see private repositories.") with a link to `/settings/connections`. German: "Verknüpfe dein GitHub-Konto, um private Repositories zu sehen."
- Admins get no bypass.

**Tests (input → expected):**
- One installation with `org/pub` (public), `org/priv` (private) and `org/hidden` (private); fake `readers: { "org/priv": ["alice"] }`.
  - Actor linked as alice → `org/pub` and `org/priv`.
  - Actor without a linked account → `org/pub` only, `githubLinked: false`.
  - An admin linked as bob → `org/pub` only.
- A second call within the TTL makes no new `canUserReadRepo` calls.
- `failWith: { canUserReadRepo: 500 }` → `org/priv` is dropped, and nothing throws.
- `linkAppRepo` for `org/hidden` as alice → InvalidError. For `org/priv` as alice → linked.
- `api.test.ts`: the permission endpoint answering `{ permission: "none" }` → false, `{ permission: "read" }` → true, 404 → false.

- [ ] Step 1: write the failing tests, then run them
- [ ] Step 2: implement; run until green, then typecheck, lint and the existing repo-picker/repo-field tests
- [ ] Step 3: commit `feat(github): only offer repositories the person can see on github`

---

### Task 8: Show and copy the roadmap ref of tasks and systems

The user asked on 2026-10-02 how to find a task id. The UI never shows it.

**Files:**
- Create: `src/components/github/copy-ref.tsx`, `src/components/github/copy-ref.test.tsx`
- Modify: `src/components/task-list.tsx` (the task row), `src/app/(app)/p/[project]/systems/[system]/system-view.tsx` (the system header), `messages/{en,de}/tasks.json` and `system.json` (or wherever the touched components' namespaces live)

**Interfaces (Produces):**

```ts
/** A small mono chip showing `refText` that copies it to the clipboard on click and toasts. */
export function CopyRef(props: { refText: string; className?: string }): JSX.Element;
```

**Directions:**
- `CopyRef` renders a `<button type="button">` with font-mono, about `text-[11.5px]`, `text-muted-foreground`, `hover:text-foreground`, and no border, so it reads like the muted metadata already in the row.
  - Its text is the ref, e.g. `roadmap#188`.
  - `aria-label` = `t("copyRef", { ref })`: English "Copy {ref} to link it from GitHub", German "{ref} kopieren, um es auf GitHub zu verknüpfen".
  - On click, `navigator.clipboard.writeText(ref)`, then `toast.success(t("refCopied", { ref }))` (English "Copied {ref}. Put it in a pull request title or description to link it."). If writing fails, `toast.error(t("refCopyFailed"))`.
  - Put these keys in the namespace that suits a shared component (`integrations.ref.*`) in both languages.
- Task row: render `<CopyRef refText={`roadmap#${task.id}`} />` in the row's main line after the title, for everyone who can see the task (viewers too). Hide it below `sm` if the row gets crowded (`hidden sm:inline-flex`).
- System page header: render `<CopyRef refText={`roadmap:${systemSlug}`} />` next to the system's title or slug metadata.
- Don't change anything else in those components.

**Tests (`copy-ref.test.tsx`, jsdom with a stubbed `navigator.clipboard.writeText`):**
- Renders `roadmap#188`.
- A click calls `writeText("roadmap#188")`.
- A rejected `writeText` → `toast.error` is called. Mock `sonner` the way other component tests do; check with `grep -rn "vi.mock(\"sonner\"" src`.

- [ ] Step 1: write the failing test, then run it
- [ ] Step 2: implement and place the chips; run until green, then typecheck and lint
- [ ] Step 3: commit `feat(tasks): show the roadmap ref of tasks and systems with a copy button`

## Final checks (after all tasks)

- `npx tsc --noEmit`, `npm run lint` and `npm test` all pass.
- Final whole-branch review on Opus, against this plan and the Review Focus.
