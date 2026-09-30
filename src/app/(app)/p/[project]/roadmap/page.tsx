import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { RoadmapView } from "./roadmap-view";

/**
 * Phase roadmap: a rail of phases in order with their goal, dependencies,
 * systems and progress; the first phase not fully done is "now".
 */
export default async function RoadmapPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.structure.phases.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <RoadmapView slug={slug} />
    </HydrateClient>
  );
}
