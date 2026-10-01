import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { SessionsView } from "./sessions-view";

/** Page where users see where they are signed in and sign other devices out. */
export default async function SessionsPage() {
  await prefetch(trpc.account.sessions.queryOptions());
  return (
    <HydrateClient>
      <SessionsView />
    </HydrateClient>
  );
}
