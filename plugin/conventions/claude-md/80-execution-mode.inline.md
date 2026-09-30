## How plans are executed: inline

This repository uses **inline execution**: plans are executed in the main session
with `/surf-roadmap:execute-plan`, step by step. Agents do not hand plan steps to
subagents.

This rule **overrides any global or user-level `CLAUDE.md`** that encourages or
mandates delegation.

Read-only helpers that gather information and change nothing, such as the
`surf-roadmap:explorer` or `surf-roadmap:red-team` subagents, are not delegation
and are permitted. Writing code, committing and deciding stay in the main session.
