import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import type { ProgressParams } from "./progress-view";
import { RoadmapView, type RoadmapMode } from "./roadmap-view";

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Phase roadmap: a rail of phases in order with their goal, dependencies,
 * systems and progress; the first phase not fully done is "now". `?view=`
 * switches to the dependency graph or the progress charts.
 */
export default async function RoadmapPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const view = one(sp.view);
  const mode: RoadmapMode = view === "graph" || view === "progress" ? view : "rail";
  const days = [14, 42, 90, 180, 365].find((d) => String(d) === one(sp.days)) ?? 42;
  // A release that no longer exists (a stale link) is dropped, so the view shows no release filter.
  const [releases] = await prefetch(trpc.releases.list.queryOptions({ project: slug }));
  const release = releases.find((r) => r.slug === one(sp.release))?.slug;
  const progress: ProgressParams = { days: days as ProgressParams["days"], phase: one(sp.phase), board: one(sp.board), domain: one(sp.domain), release };
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.structure.phases.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
    ...(mode === "progress"
      ? [
          trpc.structure.domains.queryOptions({ project: slug }),
          trpc.insight.progress.queryOptions({ project: slug, filter: { days: progress.days, phase: progress.phase, board: progress.board, domain: progress.domain, release: progress.release } }),
          trpc.insight.columnTimes.queryOptions({ project: slug, filter: { board: progress.board } }),
        ]
      : []),
  );
  return (
    <HydrateClient>
      <RoadmapView slug={slug} mode={mode} progress={progress} />
    </HydrateClient>
  );
}
