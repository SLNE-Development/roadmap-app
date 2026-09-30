import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { ActivityView, type ActivityKind } from "./activity-view";

/** How many entries the timeline shows at most. */
const LIMIT = 200;

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The project's activity: progress updates and the change log merged into one
 * timeline grouped by day, filterable by kind, person, system and agents.
 */
export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const kind = one(sp.kind) === "updates" || one(sp.kind) === "changes" ? (one(sp.kind) as ActivityKind) : undefined;
  const person = one(sp.person);
  const agentsOnly = one(sp.agents) === "1";

  const [, systems] = await prefetch(trpc.projects.get.queryOptions({ project: slug }), trpc.systems.list.queryOptions({ project: slug }));
  const system = systems.find((s) => s.slug === one(sp.system))?.slug;
  const filter = { system, limit: LIMIT };
  await prefetch(
    ...(kind === "changes" ? [] : [trpc.history.updates.queryOptions({ project: slug, filter })]),
    ...(kind === "updates" ? [] : [trpc.history.activity.queryOptions({ project: slug, filter })]),
  );

  return (
    <HydrateClient>
      <ActivityView slug={slug} kind={kind} person={person} system={system} agentsOnly={agentsOnly} limit={LIMIT} />
    </HydrateClient>
  );
}
