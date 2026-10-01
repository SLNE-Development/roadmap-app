import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { OverviewView } from "./overview-view";

/**
 * Project overview: status of all systems by category, what needs attention,
 * progress per phase and the latest progress updates.
 */
export default async function OverviewPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
    trpc.structure.phases.queryOptions({ project: slug }),
    trpc.history.updates.queryOptions({ project: slug, filter: { limit: 8 } }),
    trpc.history.activity.queryOptions({ project: slug, filter: { limit: 1 } }),
    trpc.projects.attention.queryOptions({ project: slug }),
    trpc.prefs.get.queryOptions({ key: "overview.panels" }),
  );
  return (
    <HydrateClient>
      <OverviewView slug={slug} />
    </HydrateClient>
  );
}
