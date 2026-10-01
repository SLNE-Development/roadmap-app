import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { HomeView } from "./home-view";

/** Start page: the projects the user belongs to with their state, the archived ones, and project creation. */
export default async function HomePage() {
  await prefetch(trpc.projects.cards.queryOptions(), trpc.projects.list.queryOptions({ archived: "only" }));
  return (
    <HydrateClient>
      <HomeView />
    </HydrateClient>
  );
}
