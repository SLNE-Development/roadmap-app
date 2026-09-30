---
name: check-project
description: Audit a repository against the surf-roadmap conventions and propose exactly what to change, without changing anything until approved - link file, CLAUDE.md blocks, .gitignore, legacy spec, plan and ADR files that belong in the roadmap, commit messages. Use when asked to check, audit, migrate or modernise a repository, or when an old repository predates the roadmap. Never rewrites git history and never changes code behaviour. Replaces surf-claude check-project.
argument-hint: "[path to the repository, defaults to the current directory]"
---

# surf-roadmap:check-project

**Audit first, migration second.** Nothing is written before the report is shown
and the user has selected what to apply.

## Step 1 — Audit

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/surf-roadmap.mjs" audit --repo <repo>
```

`--repo` defaults to the git top level. The output is `{ findings: [{ id, kind, what,
change }] }`, sorted missing, divergent, conforming. If it prints `{"ok":false,
"error":...}` (exit 1), tell the user the error and stop.

## Step 2 — Report

Three buckets in order: **missing**, **divergent**, **conforming** (one line each).
Every missing or divergent finding states what was found and the exact change.

## Step 3 — Apply what the user selects

Ask with the question tool (multi-select), never all-or-nothing.

- `link`, `claude-md:*`, `gitignore:*` → follow `surf-roadmap:setup` (steps 1–2 for
  the link, step 5 for the rest) for just those findings. `apply` needs the
  repository's current answers: use the `--worktrees` and `--execution` values that
  match the `worktrees` and `execution-mode` variants already in CLAUDE.md, and ask
  the user only if there are none. For divergent blocks add `--update <id>,<id>`
  (block ids without the `claude-md:` prefix). A `claude-md:*` finding about a
  malformed block (unterminated, duplicate, orphan markers) cannot be applied; the
  markers must be fixed by hand, so show the location and stop there. If any
  `apply` returns `ok:false`, report the error and apply nothing further.
- `legacy:docs/adr` → for each ADR file, in number order: show it, ask whether to
  import; `create_adr` with its sections (keep its title; map Status accepted →
  `accept_adr`; superseded → import both, then `supersede_adr`). After all imports
  succeed and the user confirms, delete the folder in a `docs:` commit.
- `legacy:docs/plans`, `legacy:docs/specs`, `legacy:docs/superpowers` → for each
  file ask which system it belongs to (or create one with `create_system`), then
  `write_spec` or `write_plan`. Planning of an imported system is not complete;
  say so. Delete the files only after the user confirms.
- `commits:*` → report only. The fix is that the next commit conforms. Never offer
  to rebase, amend or force-push.

## Step 4 — Close

Re-run `audit` (check `ok` as before) and show that the applied findings are gone. State what was left
and why. Running the skill twice produces no changes the second time.
