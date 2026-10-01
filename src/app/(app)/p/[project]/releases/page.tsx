import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { ReleasesView } from "./releases-view";

/** The project's releases: a table with target date, status, progress and slip risk. */
export default async function ReleasesPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(trpc.projects.get.queryOptions({ project: slug }), trpc.releases.list.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <ReleasesView slug={slug} />
    </HydrateClient>
  );
}
