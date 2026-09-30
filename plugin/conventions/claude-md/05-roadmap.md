## Roadmap

This repository is linked to the roadmap project named in `surf-roadmap.json`.
Specs, implementation plans, ADRs and open questions live in the roadmap and are
read and written through the `surf-roadmap` MCP server. No agent writes them as
files: no `docs/specs`, `docs/plans`, `docs/adr`, `docs/superpowers`, `SPEC.md` or
similar.

Use the `surf-roadmap:*` skills. They replace the `superpowers:*` skills in this
repository, which are blocked. Keep the roadmap current while working: start a
task with `update_task` (state `doing`), `post_update` after every commit, and
mark tasks and systems done when finished.
