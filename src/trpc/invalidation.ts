/**
 * The query routers each mutation router can affect. A mutation refetches only
 * these; a router missing here refetches everything.
 */
export const INVALIDATES: Record<string, readonly string[]> = {
  tasks: ["systems", "planning", "history", "projects"],
  systems: ["systems", "planning", "history", "projects", "boards", "questions", "adrs"],
  planning: ["planning", "systems", "history", "projects"],
  adrs: ["adrs", "systems", "history", "projects"],
  questions: ["questions", "systems", "history", "projects"],
  boards: ["boards", "systems", "projects", "history"],
  structure: ["structure", "systems", "projects", "history"],
  members: ["members", "projects", "account"],
  projects: ["projects", "boards", "systems", "structure", "members", "history"],
  account: ["account", "members"],
  history: ["history"],
};

/**
 * Reads the router name from a tRPC key such as `[["tasks","update"]]`.
 *
 * @param key a mutation or query key
 */
function routerOf(key: readonly unknown[] | undefined): string | undefined {
  const path = key?.[0];
  return Array.isArray(path) && typeof path[0] === "string" ? path[0] : undefined;
}

/**
 * Returns the query routers a mutation can affect.
 *
 * @param mutationKey the key of the mutation
 * @returns the router names, or `"all"` when the key or its router is unknown
 */
export function affectedRouters(mutationKey: readonly unknown[] | undefined): readonly string[] | "all" {
  const router = routerOf(mutationKey);
  return (router !== undefined && INVALIDATES[router]) || "all";
}

/**
 * Returns the router a tRPC query key belongs to, such as `planning` for
 * `[["planning","gaps"], { input, type: "query" }]`.
 *
 * @param queryKey the key of a query
 */
export function queryRouter(queryKey: readonly unknown[]): string | undefined {
  return routerOf(queryKey);
}
