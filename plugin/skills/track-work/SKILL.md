---
name: track-work
description: Keep the roadmap current while working so the team sees what is happening - find the system and task, set the task doing when starting (which makes you owner), post a progress update with the commit hash after every commit, mark tasks done and move the system to review or done when finished, and raise blockers as questions. Use at the start of any work in a linked repository, after every commit, when finishing a task, and when blocked.
---

# surf-roadmap:track-work

## Start

1. `list_systems` (filter by board or category) or `get_system` to find the system.
   Planning incomplete? Stop and run `surf-roadmap:plan-system`.
2. Pick the task (`get_system` shows ids). `update_task` with `state: "doing"`. This
   makes the key's user the owner of the task and of the system if they had none.
3. If the system is not in an active column, `move_system` to it.

## After every commit

`post_update` with `system`, `summary` (what changed, short markdown), `taskId`,
`commit` (the hash, even unpushed) and `nextStep`.

## Finish

`update_task` `done` for each finished task. When all are done, `move_system` to a
review column (or done if there is no review), and post a closing update.

## Blocked

`update_task` `blocked`, `surf-roadmap:open-question` for what blocks it, and a
`post_update` saying what you tried.

Always pass `agent` with your name on writes.
