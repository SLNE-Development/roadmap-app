import { httpBatchLink, splitLink, type TRPCLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/router";

/** Queries that carry a large input and therefore travel in a POST body; a GET would put it in the URL (431 and 414 past a few KiB). */
export const POST_QUERY_PATHS: readonly string[] = ["requests.posts.preview"];

/**
 * The links of the browser's tRPC client: batched calls to `url` with superjson. The queries in `POST_QUERY_PATHS` are sent with
 * POST in a batch of their own (the handler allows the method override), so a long editor draft never lands in the URL.
 *
 * @param url the tRPC endpoint
 * @param fetchImpl the fetch to use, for tests
 */
export function makeLinks(url: string, fetchImpl?: typeof fetch): TRPCLink<AppRouter>[] {
  const options = { url, transformer: superjson, ...(fetchImpl ? { fetch: fetchImpl } : {}) };
  return [
    splitLink({
      condition: (op) => op.type === "query" && POST_QUERY_PATHS.includes(op.path),
      true: httpBatchLink({ ...options, methodOverride: "POST" }),
      false: httpBatchLink(options),
    }),
  ];
}
