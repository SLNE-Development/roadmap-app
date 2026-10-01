import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { RequestView } from "./request-view";

/** One event request: status, details, brief with its versions and the history; `?tab=questions` or `?tab=overview` switches the tab. */
export default async function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ request: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ request }, sp] = await Promise.all([params, searchParams]);
  await prefetch(trpc.requests.get.queryOptions({ id: request }), trpc.requests.briefVersions.queryOptions({ id: request }), trpc.requests.rounds.queryOptions({ id: request }), trpc.requests.progress.queryOptions({ id: request }));
  return (
    <HydrateClient>
      <RequestView id={request} tab={sp.tab === "overview" || sp.tab === "questions" ? sp.tab : "brief"} />
    </HydrateClient>
  );
}
