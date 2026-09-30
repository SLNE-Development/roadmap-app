---
name: setup
description: Set a repository up for the roadmap - check the API connection, link the repository to a roadmap project and board (surf-roadmap.json), resolve global worktree and subagent restrictions through two question trees, and write the surf conventions into CLAUDE.md and .gitignore. Use first in every repository, when surf-roadmap.json is missing, or when asked to set up, configure, bootstrap, link or initialise the roadmap or project conventions. Replaces surf-claude new-project.
argument-hint: "[path to the repository, defaults to the current directory]"
---

# surf-roadmap:setup

Runs once per repository, and again whenever the user wants to change the
answers. Interactive, in this order. Every mechanical step uses:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/surf-roadmap.mjs" <command> [flags]
```

The script prints JSON. Never type a convention out from memory; the script
writes what `${CLAUDE_PLUGIN_ROOT}/conventions/` defines. Any failure (bad flag,
missing value, unreadable file, network error) prints `{"ok":false,"error":...}`
and exits 1: read `error`, tell the user, fix the call or stop. Never retry blindly
and never continue as if it had worked.

## Step 1 — Connection

Run `whoami`. If `ok` is false, tell the user exactly what the error says and how
to fix it, then stop:

- missing variable: set `ROADMAP_URL` and `ROADMAP_API_KEY` (the app's account
  menu → API keys shows both lines), then restart Claude Code;
- 401: the key is wrong, expired or revoked; create a new one;
- unreachable: check the URL.

On success, remember `name` and `projects`.

## Step 2 — Project and board

Ask with the question tool, in one round:

1. **Which project does this repository belong to?** Options: each project from
   `whoami` (label `name`, description `slug · your role`), plus "Create a new project".
2. **Default board for new systems?** Only after the project is known: options from
   `get_project` (boards by name).

For a new project, ask for its name, slug and repository URL (suggest the `origin`
remote converted to https), then call `create_project`, and ask the board question.

If `surf-roadmap.json` already exists, show its values and ask whether to keep them.

## Step 3 — The worktree tree

Run `detect-global`. If `worktrees` is null, skip to Step 4 with worktrees `none`.
Otherwise show the found section verbatim (`heading` and `text`). If `subagents` is
the same section, say that one section covers both topics. Then ask:

**"Do you want to remove your global constraint on using worktrees?"**

- **Yes** → run `remove-global --kind worktrees`, show `removed`. Worktrees: `none`.
  If the result has `alsoCovers`, that section covered the other topic too and it is
  gone: say so, re-run `detect-global`, and treat the other tree as already
  answered Yes.
- **No** → ask **"Do you want to allow worktrees in the current repository?"**
  - Yes → worktrees `allowed` (the repository's CLAUDE.md then overrides the global rule here).
  - No → worktrees `forbidden`.

## Step 4 — The subagent tree

Same shape, for `subagents` from `detect-global`:

**"Do you want to remove your global constraint on using subagents and subagent-driven development?"**

- **Yes** → `remove-global --kind subagents`, show `removed`. Execution: `none`. If
  the result has `alsoCovers`, handle it as in Step 3.
- **No** → **"Do you want to allow subagent-driven development in the current repository?"**
  - Yes → execution `subagent`.
  - No → execution `inline`.

If no global restriction exists, execution is `none`.

Removing a section edits the user's own `~/.claude/CLAUDE.md`. Ask before every
`remove-global` call; never run it without a Yes to that exact question in this
conversation. If `removed` is null, nothing was there; continue.

## Step 5 — Write

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/surf-roadmap.mjs" apply --repo <repo> --project <slug> --board <slug> --worktrees <allowed|forbidden|none> --execution <subagent|inline|none>
```

`apply` writes `surf-roadmap.json`, appends missing convention blocks to
`CLAUDE.md` (text outside the markers is never touched) and appends missing
`.gitignore` entries. If it reports `divergent` blocks, show the user which, and
ask whether to replace them; if yes, run `apply` again with the same flags plus
`--update <id>,<id>` (comma-separated block ids). If it reports `problems`
(unterminated, duplicate or orphan markers in CLAUDE.md), show them: those blocks
are left untouched and the user must fix the markers by hand. `apply` keeps other
keys already in `surf-roadmap.json`; `--repo` defaults to the git top level and
`--board` may be omitted.

## Step 6 — Other plugins

Check `claude plugin list` (or `~/.claude/settings.json` → `enabledPlugins`). If
`superpowers` or `surf` (surf-claude) is enabled, say in one sentence each: they
keep working in other repositories; in linked repositories surf-roadmap replaces
them and blocks the superpowers skills. Do not uninstall anything.

## Step 7 — Report

Report exactly: the link (project, board), CLAUDE.md blocks added/updated/left
divergent, .gitignore entries added, and what happened to the global constraints.
Do not commit; offer a `chore: Link repository to the roadmap` commit.
