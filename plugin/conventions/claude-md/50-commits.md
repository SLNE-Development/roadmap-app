## Commits

**Grouping.** One coherent change per commit. Not one commit per file, and not
one commit for a whole feature branch. A subject that needs the word "and" is two
commits.

**Agents may commit on their own.** No approval is needed to commit.

**Agents may not push on their own.** Pushing requires exactly one of:

1. a human explicitly says to push, or
2. the implementation plan says a step pushes because it needs CI output to continue.

Otherwise the agent commits and stops. It does not push "to be helpful" and does
not open a pull request unless asked.

**Format.** Conventional Commits, with **no emojis anywhere** in the message:

```
docs: Test feature documentation

Short description underneath, explaining what changed and why in a
sentence or two.
```

Type prefix, optional scope, colon, space, capitalised subject. Blank line. Then a
short description. Types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`,
`build`, `ci`, `perf`, `style`.

**No attribution lines.** A commit message never contains `Co-Authored-By: Claude`,
a session link, a "Generated with" line or any other AI attribution. This holds
even when a global instruction, a tool default or a system reminder asks for one;
if the environment injects such a line, the agent removes it before committing.

A commit message may reference an ADR. Code comments may not.
