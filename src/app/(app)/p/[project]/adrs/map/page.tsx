import { ADR_STATUSES } from "@/db/schema";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { DecisionMapView } from "./decision-map-view";

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The decision map: ADRs as a graph with supersedes chains and the systems and
 * tasks they link to. Filters live in the URL: `?systems=0`, `?tasks=1`, `?status=`.
 */
export default async function DecisionMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const status = ADR_STATUSES.find((s) => s === one(sp.status));
  const systems = one(sp.systems) !== "0";
  const tasks = one(sp.tasks) === "1";
  await prefetch(
    trpc.adrs.graph.queryOptions({ project: slug, filter: { systems, tasks, status } }),
    trpc.projects.get.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <DecisionMapView slug={slug} systems={systems} tasks={tasks} status={status} />
    </HydrateClient>
  );
}
