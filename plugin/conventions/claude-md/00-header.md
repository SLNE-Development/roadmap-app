# Project conventions

This section is managed by the `surf-roadmap` plugin. Everything between a
`surf-roadmap:block` marker and its matching `surf-roadmap:end` marker comes from
one shared definition: `/surf-roadmap:setup` writes it and
`/surf-roadmap:check-project` audits it. Change the plugin, not these blocks.
Anything outside the markers is project-specific and is never read or rewritten.

**Precedence.** These rules override any global or user-level `CLAUDE.md`,
personal defaults and tool defaults for work in this repository. Where this file
is silent, other instructions apply.
