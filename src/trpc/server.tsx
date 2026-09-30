import "server-only";
import { dehydrate, HydrationBoundary, type FetchQueryOptions } from "@tanstack/react-query";
import { TRPCError } from "@trpc/server";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createContext } from "@/server/trpc/init";
import { appRouter } from "@/server/trpc/router";
import { makeQueryClient } from "./query-client";

/** The query client of the current server render, shared by its layouts and page. */
export const getQueryClient = cache(() => makeQueryClient());

/**
 * Options of any query `prefetch` accepts, such as `trpc.projects.get.queryOptions(...)`.
 * `any`, not `unknown`: the options hold callbacks taking the query, which makes them
 * contravariant, so options of a specific query are not assignable to an `unknown` one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Prefetchable = FetchQueryOptions<any, any, any, any>;

/** Query options for every procedure, resolved in-process as the signed-in actor. */
export const trpc = createTRPCOptionsProxy({ ctx: createContext, router: appRouter, queryClient: getQueryClient });

/**
 * Loads queries into this render's cache so client components find them on
 * first paint. Unknown or invisible entities render the 404 page, a lost
 * session goes to `/login`, and other errors reach the nearest `error.tsx`.
 *
 * @returns the data of each query, in order
 */
export async function prefetch<const T extends readonly Prefetchable[]>(
  ...queries: T
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ [K in keyof T]: T[K] extends FetchQueryOptions<infer D, any, any, any> ? D : never }> {
  const client = getQueryClient();
  try {
    return (await Promise.all(queries.map((q) => client.fetchQuery(q)))) as never;
  } catch (error) {
    if (error instanceof TRPCError && error.code === "NOT_FOUND") notFound();
    if (error instanceof TRPCError && error.code === "UNAUTHORIZED") redirect("/login");
    throw error;
  }
}

/**
 * Hands this render's query cache to the client components below it.
 *
 * @param props.children the client components reading the prefetched queries
 */
export function HydrateClient({ children }: { children: React.ReactNode }) {
  return <HydrationBoundary state={dehydrate(getQueryClient())}>{children}</HydrationBoundary>;
}
