import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { RequestsView } from "./requests-view";

/** The event requests the user may see: their own, or all of them for event managers and admins. */
export default async function RequestsPage() {
  await prefetch(trpc.requests.list.queryOptions({}), trpc.account.me.queryOptions());
  return (
    <HydrateClient>
      <RequestsView />
    </HydrateClient>
  );
}
