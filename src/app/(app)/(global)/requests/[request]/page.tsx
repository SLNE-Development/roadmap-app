import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { RequestView } from "./request-view";

const TABS = ["overview", "brief", "questions", "fallback", "prep", "eventday", "messages"] as const;

/** One event request: header and lifecycle, overview, brief with its versions; `?tab=` switches to brief, questions, fallback, prep, eventday or messages; the overview is the default. */
export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ request: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ request }, sp] = await Promise.all([params, searchParams]);
  await prefetch(trpc.requests.get.queryOptions({ id: request }), trpc.requests.briefVersions.queryOptions({ id: request }), trpc.requests.rounds.queryOptions({ id: request }), trpc.requests.progress.queryOptions({ id: request }), trpc.requests.fallbacks.queryOptions({ id: request }), trpc.requests.history.queryOptions({ id: request }), trpc.requests.todos.queryOptions({ id: request }), trpc.requests.owners.queryOptions({ id: request }), trpc.requests.posts.list.queryOptions({ id: request }));
  return (
    <HydrateClient>
      <RequestView id={request} tab={TABS.find((t) => t === sp.tab) ?? "overview"} />
    </HydrateClient>
  );
}
