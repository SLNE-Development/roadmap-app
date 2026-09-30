import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { HomeView } from "./home-view";

/** Start page: the projects the user belongs to with their state, and project creation. */
export default async function HomePage() {
  await prefetch(trpc.projects.cards.queryOptions());
  return (
    <HydrateClient>
      <HomeView />
    </HydrateClient>
  );
}
