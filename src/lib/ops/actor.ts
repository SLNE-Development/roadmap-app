/** Who performs an operation: a signed-in user, optionally through a named agent. */
export interface Actor {
  userId: string;
  name: string;
  isAdmin: boolean;
  agent?: string;
}

/**
 * Returns `actor` acting through `agent`, trimmed to at most 40 characters.
 * A missing or blank agent returns the actor unchanged.
 */
export function withAgent(actor: Actor, agent?: string): Actor {
  const clean = agent?.trim().slice(0, 40);
  return clean ? { ...actor, agent: clean } : actor;
}

/**
 * Returns how an author is displayed: `<agent> (for <name>)` for agent writes,
 * otherwise the name; a missing name reads `unknown`.
 */
export function authorLabel(name: string | null | undefined, agent: string | null | undefined): string {
  const who = name?.trim() || "unknown";
  return agent ? `${agent} (for ${who})` : who;
}
