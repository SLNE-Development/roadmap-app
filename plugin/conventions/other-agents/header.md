# Project conventions

This section is managed by the `surf-roadmap` plugin (`other-agents` command).
Everything between a `surf-roadmap:block` marker and its matching
`surf-roadmap:end` marker is generated and replaced on rerun. Anything outside the
markers is project-specific and is never rewritten.

**Precedence.** These rules override personal defaults and tool defaults for work
in this repository. Where this file is silent, other instructions apply.

## Roadmap MCP server

{{linked}} Specs, plans, ADRs and open questions live in the roadmap
and are read and written through its MCP server. Add it to your agent:

- URL: `${ROADMAP_URL}/api/mcp` (streamable HTTP)
- Sign-in: OAuth in the browser, for agents that support it; otherwise the header
  `Authorization: Bearer ${ROADMAP_API_KEY}`

Codex, in `~/.codex/config.toml`: a `[mcp_servers.roadmap]` entry with that URL,
then `codex mcp login roadmap`; without OAuth, add
`bearer_token_env_var = "ROADMAP_API_KEY"`. Cursor, in `.cursor/mcp.json`: a
`roadmap` server with that URL (Cursor signs in itself). API keys are created in
the app's account menu (API keys).

## Without the plugin

You have no `surf-roadmap:*` skills, so use the MCP server directly:

- Start of work: call `get_project` and the planning tools to read the current
  specs, plan and open questions before you change anything.
- Planning: run the roadmap's `plan` MCP prompt and follow it. Specs, plans and
  ADRs are written back to the roadmap with the document and ADR tools.
- Never write specs, plans or ADRs as files: no `docs/specs`, `docs/plans`,
  `docs/adr`, `docs/superpowers`, `SPEC.md` or similar.

## Track your work

- Start a task: `update_task` with state `doing`.
- After every commit: `post_update` with what changed.
- When finished: mark the task, and the system once all its tasks are done, as done.
- Add follow-up work with `add_tasks` and open questions with the question tools,
  rather than leaving them in code comments or chat.
