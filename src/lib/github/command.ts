/** The longest query a `/roadmap` command carries. */
const MAX_QUERY = 200;

/**
 * Parses a `/roadmap` command from a comment: returns `{ query }` when the comment's first non-blank line is
 * `/roadmap` optionally followed by text (the query is trimmed and cut to 200 characters); otherwise null.
 */
export function parseRoadmapCommand(body: string): { query: string } | null {
  const first = body.split("\n").find((l) => l.trim() !== "");
  if (first === undefined) return null;
  const m = /^\/roadmap(?:\s+(.+))?$/i.exec(first.trim());
  if (!m) return null;
  return { query: (m[1] ?? "").trim().slice(0, MAX_QUERY) };
}
