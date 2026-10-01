"use client";

import { isServer, MutationCache, QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext } from "@trpc/tanstack-react-query";
import { useState } from "react";
import { toast } from "sonner";
import superjson from "superjson";
import type { AppRouter } from "@/server/trpc/router";
import { shouldInvalidate } from "./invalidation";
import { makeQueryClient, queryProject } from "./query-client";

/** The typed tRPC hooks: `useTRPC()` returns query and mutation options for every procedure. */
export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /** Skip the automatic error toast; the caller shows the error itself. */
      quiet?: boolean;
      /** Slug of a project the user no longer has access to once the mutation succeeds. */
      leavesProject?: string;
    };
  }
}

/**
 * Creates the browser's query client. After every successful mutation the
 * queries of the routers it can affect (see `INVALIDATES`) are invalidated and
 * refetched before the mutation settles, so the page shows the change once
 * `onSuccess` runs; a mutation without a known router refetches everything. A
 * mutation that leaves a project first drops that project's queries, which could
 * only fail now, and refetches the rest. Failed mutations toast their message.
 */
function makeBrowserQueryClient(): QueryClient {
  const client: QueryClient = makeQueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        const slug = mutation.meta?.leavesProject;
        if (slug) client.removeQueries({ predicate: (q) => queryProject(q.queryKey) === slug });
        return client.invalidateQueries({ predicate: (q) => shouldInvalidate(q.queryKey, mutation.options.mutationKey, slug) });
      },
      onError: (error, _variables, _context, mutation) => {
        if (!mutation.meta?.quiet) toast.error(error.message);
      },
    }),
  });
  return client;
}

/** The browser keeps one query client across renders; each server render gets its own. */
let browserQueryClient: QueryClient | undefined;

/** Returns the query client of this render. */
function getQueryClient(): QueryClient {
  if (isServer) return makeBrowserQueryClient();
  return (browserQueryClient ??= makeBrowserQueryClient());
}

/**
 * Provides React Query and the tRPC client to every client component. Calls go
 * to `/api/trpc`, batched, with superjson so dates and maps survive the trip.
 *
 * @param props.children the app
 */
export function TRPCReactProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [trpcClient] = useState(() =>
    createTRPCClient<AppRouter>({
      links: [httpBatchLink({ url: isServer ? `http://localhost:${process.env.PORT ?? 3000}/api/trpc` : "/api/trpc", transformer: superjson })],
    }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  );
}
