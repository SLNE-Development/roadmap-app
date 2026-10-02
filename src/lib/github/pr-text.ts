/** The prefix of the body line that lists the roadmap items a pull request relates to. */
export const ROADMAP_LINE = "Roadmap:";

/** Escapes `s` for use inside a regular expression. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns the pull request fields to write so `ref` appears in it, or null when the ref is already in the title or
 * body (case-insensitive, and not merely the prefix of a longer number).
 *
 * @param closes when true the ref goes into the title, so GitHub-style closing is visible there; otherwise it goes
 *   on the body's `Roadmap:` line, which is created when missing
 */
export function withRef(
  pr: { title: string; body: string },
  ref: string,
  closes: boolean,
): { title?: string; body?: string } | null {
  const present = new RegExp(`${escapeRegExp(ref)}(?![\\w-])`, "i");
  if (present.test(pr.title) || present.test(pr.body)) return null;
  if (closes) return { title: `${pr.title} ${ref}` };
  const eol = pr.body.includes("\r\n") ? "\r\n" : "\n";
  const lines = pr.body.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().startsWith(ROADMAP_LINE));
  if (at >= 0) {
    lines[at] = `${lines[at]} ${ref}`;
    return { body: lines.join(eol) };
  }
  return { body: pr.body.trim() === "" ? `${ROADMAP_LINE} ${ref}` : `${pr.body}${eol}${eol}${ROADMAP_LINE} ${ref}` };
}
