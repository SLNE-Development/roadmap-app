# surf-roadmap

Claude Code plugin for the roadmap app. In every repository linked to a roadmap
project it:

- runs an exhaustive, adversarial planning interview before any system is built
  (`/surf-roadmap:plan`), stores every round in the roadmap and writes the spec there;
- writes implementation plans into the roadmap (their steps become tasks) and
  executes them while posting progress after every commit;
- records ADRs and open questions in the roadmap;
- applies the surf conventions (English only, ask never assume, Conventional
  Commits without AI attribution, doc comments that say what code does);
- replaces every superpowers skill with a roadmap-aware one and blocks the originals;
- ships subagents pinned to models (implementer on sonnet, reviewers on sonnet and opus, ADR writer on haiku, …).

## Install

```
/plugin marketplace add SLNE-Development/roadmap-app
/plugin install surf-roadmap@surf-roadmap
```

Create an API key in the app (account menu → API keys) and set the two lines it
shows as environment variables before starting Claude Code:

```
ROADMAP_URL=https://roadmap.example.com
ROADMAP_API_KEY=rmk_…
```

`ROADMAP_URL` must not end with a slash.

Then, in each repository: `/surf-roadmap:setup`.

## What "linked" means

A repository is linked when `surf-roadmap.json` exists at its root:

```json
{ "project": "surf-roleplay", "board": "development" }
```

Hooks only act in linked repositories. Elsewhere, superpowers and everything else
behave as usual.

## Skills

| Skill | Replaces |
| --- | --- |
| `setup`, `check-project` | surf-claude `new-project`, `check-project` |
| `using-surf-roadmap` | superpowers `using-superpowers` |
| `plan-system` | superpowers `brainstorming` |
| `write-plan` | superpowers `writing-plans`, surf-claude `new-plan` |
| `execute-plan` | superpowers `executing-plans` |
| `subagent-driven-development`, `dispatching-parallel-agents`, `using-git-worktrees`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `finishing-a-development-branch`, `writing-skills` | the superpowers skills of the same name |
| `new-adr` | surf-claude `new-adr` |
| `open-question`, `track-work`, `event-requests` | — |

The forked skills are adapted from superpowers 6.4.1 by Jesse Vincent, MIT
licensed; see `LICENSES/superpowers-MIT.txt`.

## Commands

`/surf-roadmap:plan <idea>`, `/surf-roadmap:status`, `/surf-roadmap:next`,
`/surf-roadmap:setup`, `/surf-roadmap:requests [update|event-day|messages] <request-id>`.

`/surf-roadmap:requests <request-id>` develops an accepted event request (first time); `update <request-id>` brings its system in line after the planner changed the brief. There is no list tool, so without an id the command asks for it (the last part of the request's URL). `event-day <request-id>` writes the event-day checklist with `set_event_checklist`. `messages <request-id>` writes the team, announcement and reminder drafts and the short description with `write_event_messages` (drafts only; posting stays in the app). It uses `get_request`, `ask_requester`, `set_event_checklist` and `write_event_messages`; see the `event-requests` skill and [`docs/event-requests.md`](../docs/event-requests.md).
