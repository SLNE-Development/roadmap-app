import { queryProject } from "./query-client";

/**
 * The query routers each mutation router can affect. A mutation refetches only
 * these; a router missing here refetches everything.
 */
export const INVALIDATES: Record<string, readonly string[]> = {
  tasks: ["tasks", "systems", "planning", "history", "projects", "structure", "adrs"],
  systems: ["systems", "planning", "history", "projects", "boards", "questions", "adrs", "structure", "tasks"],
  planning: ["planning", "systems", "history", "projects"],
  adrs: ["adrs", "systems", "history", "projects"],
  questions: ["questions", "systems", "planning", "history", "projects"],
  boards: ["boards", "systems", "planning", "projects", "history"],
  fields: ["fields", "systems", "projects", "history"],
  structure: ["structure", "systems", "projects", "history"],
  members: ["members", "projects", "account"],
  projects: ["projects", "boards", "systems", "structure", "members", "history"],
  account: ["account", "members"],
  history: ["history"],
  prefs: ["prefs"],
  views: ["views"],
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
  return (router !== undefined && Object.hasOwn(INVALIDATES, router) && INVALIDATES[router]) || "all";
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

/**
 * Decides whether a successful mutation refetches a query. Queries of a project
 * the user just left are skipped; every other query refetches when its router is
 * affected, including queries without a project such as `account.apiKeys`.
 *
 * @param queryKey the key of the query
 * @param mutationKey the key of the mutation
 * @param leftSlug the slug of the project the mutation leaves, if any
 */
export function shouldInvalidate(queryKey: readonly unknown[], mutationKey: readonly unknown[] | undefined, leftSlug: string | undefined): boolean {
  if (leftSlug !== undefined && queryProject(queryKey) === leftSlug) return false;
  const routers = affectedRouters(mutationKey);
  return routers === "all" || routers.includes(queryRouter(queryKey) ?? "");
}
