import { nextActivityCursor, parseGroups } from "@/lib/activity-groups";
import { getQueryClient, HydrateClient, prefetch, trpc } from "@/trpc/server";
import { ActivityView, type ActivityKind } from "./activity-view";

/** How many entries one page of the timeline holds; "Load older" fetches the next page. */
const LIMIT = 100;

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The project's activity: progress updates and the change log merged into one
 * timeline grouped by day, filterable by kind, person, system, agents and entity groups on the server.
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
  const agentsParam = one(sp.agents);
  // The old `agents=1` link means "only".
  const agents: "only" | "exclude" | undefined = agentsParam === "exclude" ? "exclude" : agentsParam === "only" || agentsParam === "1" ? "only" : undefined;
  const groups = parseGroups(one(sp.groups));

  const [, systems, members] = await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
    trpc.members.list.queryOptions({ project: slug }),
    trpc.releases.list.queryOptions({ project: slug }),
  );
  const system = systems.find((s) => s.slug === one(sp.system))?.slug;
  // `person` is a user id; an old link carries a name, which the view matches client-side.
  const person = one(sp.person);
  const personId = members.find((m) => m.userId === person)?.userId;
  const legacyPerson = person && !personId ? person : undefined;
  // Progress updates belong to no entity group: the group filter narrows changes only.
  const showUpdates = kind !== "changes";
  const filter = { system, person: personId, agents, limit: LIMIT };
  const changeFilter = { ...filter, groups: groups.length ? groups : undefined };
  await Promise.all([
    ...(showUpdates
      ? [
          getQueryClient().fetchInfiniteQuery(
            trpc.history.updates.infiniteQueryOptions(
              { project: slug, filter },
              { getNextPageParam: (page) => nextActivityCursor(page, LIMIT) },
            ),
          ),
        ]
      : []),
    ...(kind === "updates"
      ? []
      : [
          getQueryClient().fetchInfiniteQuery(
            trpc.history.activity.infiniteQueryOptions(
              { project: slug, filter: changeFilter },
              { getNextPageParam: (page) => nextActivityCursor(page, LIMIT) },
            ),
          ),
        ]),
  ]);

  return (
    <HydrateClient>
      <ActivityView
        slug={slug}
        kind={kind}
        person={personId}
        legacyPerson={legacyPerson}
        system={system}
        agents={agents}
        groups={groups}
        limit={LIMIT}
      />
    </HydrateClient>
  );
}
