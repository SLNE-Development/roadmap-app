/** Matches a stored mention token, `[@Name](user:<id>)`. */
export const MENTION_RE = /\[@([^\]\n]{1,64})\]\(user:([0-9a-f-]{36})\)/g;

/** A user as a mention can name them. */
export interface MentionMember {
  userId: string;
  name: string;
}

/** Returns the stored token for a mention; `[`, `]` and newlines are stripped from the name. */
export function formatMention(name: string, userId: string): string {
  return `[@${name.replace(/[[\]\r\n]/g, "")}](user:${userId})`;
}

/** Returns the mentioned users, unique by id, in order of first appearance. */
export function parseMentions(text: string): MentionMember[] {
  const seen = new Map<string, MentionMember>();
  for (const m of text.matchAll(MENTION_RE)) {
    if (!seen.has(m[2])) seen.set(m[2], { userId: m[2], name: m[1] });
  }
  return [...seen.values()];
}

/** Replaces every mention token with `@Name`. */
export function mentionsToPlain(text: string): string {
  return text.replace(MENTION_RE, (_all, name: string) => `@${name}`);
}

/** Returns the user ids mentioned in `after` that `before` did not mention. */
export function newMentions(before: string | null, after: string): string[] {
  const old = new Set(before ? parseMentions(before).map((m) => m.userId) : []);
  return parseMentions(after)
    .map((m) => m.userId)
    .filter((id) => !old.has(id));
}

/** Code (fenced or inline) and existing tokens: segments that are never resolved. */
const PROTECTED_RE = /(```[\s\S]*?```|`[^`\n]*`|\[@[^\]\n]{1,64}\]\(user:[0-9a-f-]{36}\))/;
const BOUNDARY_RE = /^(?:$|[\s.,;:!?)])/;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

/**
 * Turns `@Name` into a mention token when Name matches exactly one member, case-insensitively.
 * Longest names win, a boundary must follow, and code, emails and existing tokens are left alone.
 */
export function resolveMentionNames(text: string, members: MentionMember[]): string {
  const byName = new Map<string, MentionMember[]>();
  for (const m of members) {
    const key = m.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), m]);
  }
  const names = [...byName.keys()].filter((n) => n.length > 0).sort((a, b) => b.length - a.length);
  if (names.length === 0) return text;

  const resolvePlain = (segment: string): string => {
    let out = "";
    let i = 0;
    while (i < segment.length) {
      const ch = segment[i];
      if (ch !== "@" || (i > 0 && WORD_CHAR_RE.test(segment[i - 1]))) {
        out += ch;
        i += 1;
        continue;
      }
      const rest = segment.slice(i + 1);
      const lower = rest.toLowerCase();
      const hit = names.find((n) => lower.startsWith(n) && BOUNDARY_RE.test(rest.slice(n.length)));
      const matched = hit ? byName.get(hit)! : [];
      if (hit && matched.length === 1) {
        out += formatMention(matched[0].name, matched[0].userId);
        i += 1 + hit.length;
      } else {
        out += ch;
        i += 1;
      }
    }
    return out;
  };

  // split with a single capture group: odd indexes are the protected segments
  return text
    .split(PROTECTED_RE)
    .map((part, idx) => (idx % 2 === 1 ? part : resolvePlain(part)))
    .join("");
}
