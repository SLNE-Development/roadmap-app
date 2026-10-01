import type { ColumnCategory } from "@/db/schema";
import { slugify } from "@/lib/slug";

/** The project template an accepted event request gets: its board, phases, domain and the priority of its system. */
export const EVENT_TEMPLATE = {
  board: {
    slug: "event",
    name: "Event",
    columns: [
      { name: "Planning", category: "planning" },
      { name: "To do", category: "todo" },
      { name: "Building", category: "active" },
      { name: "Review", category: "review" },
      { name: "Blocked", category: "blocked" },
      { name: "Done", category: "done" },
    ] satisfies { name: string; category: ColumnCategory }[],
  },
  phases: ["Build", "Rehearsal", "Event day"],
  domain: "Event",
  priority: "MVP",
} as const;

/**
 * Builds a free slug from a title: the slugified title (`event` when it has no usable characters), then `-2`, `-3` and so on while `taken` says a slug is in use.
 *
 * @param taken whether a slug is already used
 */
export async function projectSlugFromTitle(title: string, taken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(title) || "event";
  let slug = base;
  for (let n = 2; await taken(slug); n++) slug = `${base.slice(0, 64 - String(n).length - 1)}-${n}`;
  return slug;
}
