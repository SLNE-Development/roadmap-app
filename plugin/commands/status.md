---
description: Show the linked roadmap project's active, blocked and planning systems
---

Read `surf-roadmap.json` for the project. Call `list_systems` for the project and
show, grouped by column category in this order: active, blocked, review, planning
(with how many planning items are still open from `get_system` for at most five of
them), then a count of todo and done. For each system: title, board, column, owner,
tasks done/total. End with the three newest `list_updates` entries. Do not change anything.
