---
name: new-adr
description: Record a decision the user has actually made as an ADR in the roadmap, or supersede an accepted one. Use after any decision that constrains future work, is expensive to reverse, trades one property against another, affects the security model, changes a public API or a wire or on-disk format, or adds a runtime dependency. Refuses to record decisions that were not made, enforces one decision per record, demands honest alternatives and real costs. Replaces surf-claude new-adr.
argument-hint: "[the decision, in one line]"
---

# surf-roadmap:new-adr

An ADR is the decision, not a report about a conversation. The roadmap numbers it.
Delegating the writing to the `surf-roadmap:adr-writer` subagent is fine when
subagents are allowed; the checks below still happen in the main session.

## Refuse before writing

Check all four. If one fails, say which and stop.

1. **The decision has been made**: the user chose between named options. If not,
   present the options and trade-offs and ask. Your preference is not a decision.
2. **It is one decision.** If the title needs "and", it is two ADRs; ask which first.
3. **It needed a human.** No lasting consequence and no real alternative → no ADR.
4. **Every section can be filled honestly.**

## Write it

`create_adr` with `project`, `title`, and all four sections:

- **context** — what forced a decision, readable by someone who was not there. No
  "the user asked".
- **decision** — present tense, as a rule the project now follows.
- **alternatives** — only real ones; each states its real advantage first, then
  what disqualified it.
- **consequences** — what it gives, what it costs, follow-on work, and what it
  forecloses (and what a reversal would cost). Benefits only → rewrite.

Pass `systems` with the slugs it concerns. Show the created ADR and ask the user
to confirm the text; then `accept_adr`. Accepted ADRs are immutable.

## Superseding

Write the new ADR (its context says what changed), accept it, then
`supersede_adr` with `number` = old and `by` = new. Never edit the old one.
