## Documentation comments

**Every function gets a doc comment**: public, internal, private, extension, every
one. The same applies to classes, interfaces and public properties. Use the
language's form: KDoc, Javadoc, docstrings, TSDoc.

A doc comment describes **what the code does**. It never describes how the code
came to exist. Forbidden in doc comments, without exception:

- references to decision records: `according to ADR-0007`
- references to plans or specs: `see the implementation plan`
- references to conversations, tickets, reviews or the user: `as requested`
- change history: `changed from X`, `previously used Y`
- justification of the design: `we chose this because`

A reader must learn what the function does, not how the team got there. Rationale
belongs in an ADR, and the ADR is not linked from the code.

Good:

```kotlin
/**
 * Resolves an action token to the handler it was issued for.
 *
 * A token is valid only for the screen instance that issued it and only until
 * that screen is closed or re-rendered. Tokens are single-use.
 *
 * @param token the token received from the client
 * @return the bound handler, or `null` if the token is unknown, expired, or
 *         belongs to a different screen instance
 */
private fun resolve(token: ActionToken): BoundAction?
```
