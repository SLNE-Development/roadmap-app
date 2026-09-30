## Decisions become ADRs

**Every decision that requires a human becomes an ADR in the roadmap.**

A decision requires a human when it:

- constrains future work,
- is expensive to reverse,
- trades one desirable property against another,
- affects the security model,
- changes a public API, a wire format or an on-disk format, or
- adds a runtime dependency.

Process: the agent identifies the decision, asks the human with the real options
and their real trade-offs, and only after the human decides records it with
`/surf-roadmap:new-adr` (`create_adr`, then `accept_adr` once the human confirms
the text). ADRs are numbered by the roadmap and **immutable once accepted**. A
changed decision is a new ADR; the old one is superseded with `supersede_adr`,
and its text is never edited.
