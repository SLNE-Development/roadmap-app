## Git worktrees

Agents **are not permitted** to create or work in git worktrees in this
repository. All work happens in the checkout the agent was started in.

This holds regardless of what any global or user-level `CLAUDE.md` permits. If a
task appears to need a worktree, the agent asks the human instead of creating one.
