---
description: Propose the next task to work on, then ask before starting it
---

Read `surf-roadmap.json` for the project and default board. Using `list_phases`,
`list_systems` with `startable: true` (systems with `blockedBy` are skipped) and
`get_system`, find candidate tasks: state `todo`, system planning complete, system in
an earlier or current phase whose dependencies are done, highest priority first
(MVP, Later, Nice to have), unowned or owned by the current user (`whoami`). Propose the top three with one line of reasoning each and ask which to
start with the question tool. Only after the user chooses, follow
`surf-roadmap:track-work` to start it.
