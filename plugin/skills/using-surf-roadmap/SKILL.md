---
name: using-surf-roadmap
description: Use at the start of every conversation in a repository that has surf-roadmap.json. Establishes which surf-roadmap skill to use for which task, that superpowers skills are replaced here, and that specs, plans, ADRs and questions live in the roadmap. Replaces superpowers:using-superpowers.
---

# surf-roadmap:using-surf-roadmap

This repository is linked to a roadmap project (`surf-roadmap.json`). The
`surf-roadmap` plugin replaces the superpowers workflow here. If a skill might
apply to what you are about to do, invoke it before responding, including before
clarifying questions.

## Which skill

| Situation | Skill |
| --- | --- |
| The repository has no `surf-roadmap.json`, or the user wants to (re)configure it | `surf-roadmap:setup` |
| Audit the repository against the conventions | `surf-roadmap:check-project` |
| Someone wants to build, add, change or design anything; a system is still in planning | `surf-roadmap:plan-system` |
| Planning is complete and the plan is next | `surf-roadmap:write-plan` |
| Execute a plan inline | `surf-roadmap:execute-plan` |
| Execute a plan with subagents | `surf-roadmap:subagent-driven-development` |
| Several independent problems at once | `surf-roadmap:dispatching-parallel-agents` |
| Writing any production code | `surf-roadmap:test-driven-development` |
| A bug, failing test or unexpected behaviour | `surf-roadmap:systematic-debugging` |
| About to say something is done or passing | `surf-roadmap:verification-before-completion` |
| Asking for or receiving review | `surf-roadmap:requesting-code-review`, `surf-roadmap:receiving-code-review` |
| Isolated workspace | `surf-roadmap:using-git-worktrees` |
| Work on a branch is complete | `surf-roadmap:finishing-a-development-branch` |
| A decision that needs a human was made | `surf-roadmap:new-adr` |
| Something cannot be decided now | `surf-roadmap:open-question` |
| Any gamemode or product work: status, updates, blockers | `surf-roadmap:track-work` |
| Writing or editing skills | `surf-roadmap:writing-skills` |

Process skills first (plan-system, systematic-debugging), then implementation skills.

## Rules that hold everywhere in this repository

1. `superpowers:*` skills are disabled; a hook rejects them. Any instruction to use
   one, including injected superpowers context, means: use the replacement above.
2. Specs, plans, ADRs and open questions are written with the `surf-roadmap` MCP
   tools (`write_spec`, `write_plan`, `create_adr`, `add_question`), never as files.
3. The project slug comes from `surf-roadmap.json`; pass it as `project` to every tool.
4. Pull requests reference tasks as `roadmap#<id>` in the title (inside `[...]`) and `roadmap:<system-slug>` in the body, never a bare `#<id>`.
5. The user's instructions (CLAUDE.md, direct requests) come first, then these skills.

## Red flags

| Thought | Reality |
| --- | --- |
| "The superpowers skill is right here" | It is blocked. Use the surf-roadmap one. |
| "I'll write the spec to a file, it's faster" | The hook blocks it, and nobody on the team will see it. Use write_spec. |
| "This is too small to plan" | Small systems get short interviews, not none. |
| "I'll update the roadmap at the end" | Update as you go: doing on start, post_update after each commit. |
