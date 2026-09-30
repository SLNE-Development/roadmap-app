import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/router";

/** Every tRPC call reads live data. */
export const dynamic = "force-dynamic";

/** Serves the web UI's tRPC router; procedures check the session themselves. */
function handler(request: Request): Promise<Response> {
  return fetchRequestHandler({ endpoint: "/api/trpc", req: request, router: appRouter, createContext });
}

/** tRPC queries. */
export const GET = handler;

/** tRPC mutations and batched calls. */
export const POST = handler;
