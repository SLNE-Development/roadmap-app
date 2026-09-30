import { defaultShouldDehydrateQuery, QueryClient, type QueryClientConfig } from "@tanstack/react-query";
import superjson from "superjson";

/**
 * Decides whether a failed query is tried again: never after a 4xx answer, which
 * a retry cannot change, and otherwise up to three times.
 *
 * @param failureCount how many times the query has failed so far
 * @param error the error of the last attempt
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
  if (typeof status === "number" && status >= 400 && status <= 499) return false;
  return failureCount < 3;
}

/**
 * Reads the project slug a tRPC query key was made for, such as
 * `[["projects","get"], { input: { project: "demo" }, type: "query" }]`.
 *
 * @param queryKey the key of a query
 * @returns the slug, or `undefined` when the query is not about one project
 */
export function queryProject(queryKey: readonly unknown[]): string | undefined {
  const options = queryKey[1] as { input?: { project?: unknown } } | undefined;
  const project = options?.input?.project;
  return typeof project === "string" ? project : undefined;
}

/**
 * Creates a query client for one server render or for the browser. Data counts
 * as fresh for 30 seconds so the browser does not refetch what the server just
 * prefetched; mutations keep it current by invalidating. Failed queries are not
 * retried after a 4xx answer. Dehydration carries dates and maps through superjson.
 *
 * @param config extra configuration, such as the browser's mutation cache
 */
export function makeQueryClient(config: Omit<QueryClientConfig, "defaultOptions"> = {}): QueryClient {
  return new QueryClient({
    ...config,
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetryQuery },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
      hydrate: { deserializeData: superjson.deserialize },
    },
  });
}
