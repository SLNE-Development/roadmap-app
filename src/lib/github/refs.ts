/** `roadmap#<id>`: a bare `#188` is GitHub's own issue reference, so it never counts. */
const TASK_REF = /(?<![\w/#-])roadmap#(\d{1,9})(?!\w)/gi;
/** `roadmap:<slug>`, not inside a URL or a longer word. */
const SYSTEM_REF = /(?<![\w/:-])roadmap:([a-z0-9]+(?:-[a-z0-9]+)*)(?![\w-])/gi;
const MAX_SLUG = 64;

/** The roadmap references found in a text. */
export interface Refs {
  tasks: number[];
  systems: string[];
}

/** Returns the task ids (`roadmap#188`) and system slugs (`roadmap:search-index`) in `text`, unique, in first-seen order. */
export function parseRefs(text: string): Refs {
  const tasks = new Set<number>();
  for (const match of text.matchAll(TASK_REF)) tasks.add(Number(match[1]));
  const systems = new Set<string>();
  for (const match of text.matchAll(SYSTEM_REF)) {
    const slug = match[1].toLowerCase();
    if (slug.length <= MAX_SLUG) systems.add(slug);
  }
  return { tasks: [...tasks], systems: [...systems] };
}
