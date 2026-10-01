/** The most words a search query keeps. */
const MAX_WORDS = 8;

/**
 * Turns free text into a safe `to_tsquery` string: every word of at least two letters or digits
 * becomes a lowercased prefix term, and the terms are joined with `&`. Any tsquery syntax in the
 * text is dropped, so the result never fails to parse.
 *
 * @param raw the text the user typed
 * @returns the query, or `null` when no usable word is left
 */
export function toPrefixQuery(raw: string): string | null {
  const words = raw
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, MAX_WORDS);
  return words.length === 0 ? null : words.map((w) => `${w.toLowerCase()}:*`).join(" & ");
}
