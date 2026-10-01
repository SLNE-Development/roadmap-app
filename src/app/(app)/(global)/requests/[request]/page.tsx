import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { RequestView } from "./request-view";

const TABS = ["overview", "questions", "fallback", "prep", "eventday"] as const;

/** One event request: status, details, brief with its versions and the history; `?tab=` switches to questions, fallback, prep, eventday or overview. */
export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ request: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ request }, sp] = await Promise.all([params, searchParams]);
  await prefetch(trpc.requests.get.queryOptions({ id: request }), trpc.requests.briefVersions.queryOptions({ id: request }), trpc.requests.rounds.queryOptions({ id: request }), trpc.requests.progress.queryOptions({ id: request }), trpc.requests.fallbacks.queryOptions({ id: request }));
  return (
    <HydrateClient>
      <RequestView id={request} tab={TABS.find((t) => t === sp.tab) ?? "brief"} />
    </HydrateClient>
  );
}
