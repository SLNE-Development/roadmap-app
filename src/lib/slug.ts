/**
 * Derives a slug from a title: lowercase words joined by single dashes, at most
 * 64 characters, matching the slug rule or empty.
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}
