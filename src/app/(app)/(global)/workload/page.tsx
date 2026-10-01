import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { WorkloadView } from "./workload-view";

/**
 * Team workload: what everyone in the actor's projects owns and has open,
 * optionally narrowed to one project with `?project=`.
 */
export default async function WorkloadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const [projects] = await prefetch(trpc.account.workloadProjects.queryOptions());
  const project = projects.find((p) => p.slug === sp.project)?.slug;
  await prefetch(trpc.account.workload.queryOptions({ project }));
  return (
    <HydrateClient>
      <WorkloadView project={project} />
    </HydrateClient>
  );
}
