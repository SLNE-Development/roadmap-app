import type { ChangeEvent } from "@/worker/feed";

/**
 * The query routers to refetch for each change-log entity. Every key is a router name in `appRouter`;
 * a test checks it. Entities shown on the system page include `systems`, and live charts include `insight`.
 */
export const INVALIDATION_KEYS: Record<string, readonly string[]> = {
  project: ["projects", "history"],
  board: ["boards", "projects", "systems", "history", "insight", "gates"],
  column: ["boards", "projects", "systems", "history", "insight", "gates"],
  domain: ["structure", "systems", "projects", "history", "insight"],
  phase: ["structure", "systems", "projects", "history", "insight"],
  system: ["systems", "boards", "projects", "planning", "history", "insight", "releases", "gates", "requests"],
  task: ["systems", "projects", "history", "insight", "gates", "requests"],
  document: ["systems", "history", "gates"],
  planning: ["planning", "systems", "projects", "history", "requests"],
  adr: ["adrs", "systems", "projects", "history", "gates"],
  question: ["questions", "systems", "projects", "history", "gates"],
  update: ["systems", "history", "gates"],
  member: ["members", "projects"],
  check: ["systems", "history", "gates"],
  dependency: ["systems", "history"],
  field: ["fields", "systems", "history"],
  glossary: ["glossary", "history"],
  page: ["pages", "history"],
  release: ["releases", "systems", "insight", "history"],
  repo: ["github", "history"],
  code: ["github", "systems", "history"],
  webhook: ["webhooks", "history"],
};

/** The routers to refetch for an entity missing from `INVALIDATION_KEYS`. */
export const FALLBACK_KEYS: readonly string[] = ["projects", "systems", "boards", "history"];

/**
 * Groups change events by project and returns the routers each project must refetch.
 *
 * @param events change-log rows
 * @returns project id to sorted, unique router names
 */
export function invalidationKeys(events: ChangeEvent[]): Map<string, string[]> {
  const sets = new Map<string, Set<string>>();
  for (const event of events) {
    let set = sets.get(event.projectId);
    if (!set) sets.set(event.projectId, (set = new Set()));
    const keys = Object.hasOwn(INVALIDATION_KEYS, event.entity) ? INVALIDATION_KEYS[event.entity] : FALLBACK_KEYS;
    for (const key of keys) set.add(key);
  }
  return new Map([...sets].map(([id, set]) => [id, [...set].sort()]));
}

/** The pub/sub channel carrying a project's realtime messages. */
export function realtimeChannel(projectId: string): string {
  return `project:${projectId}`;
}
