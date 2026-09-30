import { defaultShouldDehydrateQuery, QueryClient, type QueryClientConfig } from "@tanstack/react-query";
import superjson from "superjson";

/**
 * Creates a query client for one server render or for the browser. Data counts
 * as fresh for 30 seconds so the browser does not refetch what the server just
 * prefetched; mutations keep it current by invalidating. Dehydration carries
 * dates and maps through superjson.
 *
 * @param config extra configuration, such as the browser's mutation cache
 */
export function makeQueryClient(config: Omit<QueryClientConfig, "defaultOptions"> = {}): QueryClient {
  return new QueryClient({
    ...config,
    defaultOptions: {
      queries: { staleTime: 30_000 },
      dehydrate: {
        serializeData: superjson.serialize,
        shouldDehydrateQuery: (query) => defaultShouldDehydrateQuery(query) || query.state.status === "pending",
      },
      hydrate: { deserializeData: superjson.deserialize },
    },
  });
}
