/** Avatar and project-mark colours; each has white text at 4.5:1 or better. */
const PALETTE = ["#8a5cf6", "#e8643c", "#0e7c86", "#c2410c", "#2563eb", "#16a34a", "#db2777", "#4f46e5", "#a86f00", "#b42323"];

/** Returns a stable colour for `key` (a name or slug) from the shared palette. */
export function identityColor(key: string): string {
  let hash = 0;
  for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/**
 * Returns up to two initials of `name`: the first letters of its first and
 * last words, or the first two letters of a single word, upper-cased.
 */
export function initials(name: string): string {
  const words = name.trim().split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
