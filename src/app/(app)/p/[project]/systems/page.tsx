import { systemFilter } from "@/lib/ops/systems";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { SystemsView } from "./systems-view";

/** Query keys the page reads; the filter keys match {@link systemFilter}. */
const KEYS = ["q", "board", "domain", "phase", "category", "priority", "owner", "group", "view"] as const;

/** Reads one string search parameter, or an empty string. */
function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * All systems of a project as a table or card grid, searchable, filterable by
 * board, domain, phase, status, priority and owner, and grouped by domain,
 * phase or board. Every control lives in the URL query.
 */
export default async function SystemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const current = Object.fromEntries(KEYS.map((k) => [k, param(sp[k])]).filter(([, v]) => v)) as Record<string, string>;
  const parsed = systemFilter.safeParse(Object.fromEntries(Object.entries(current).filter(([k]) => !["q", "group", "view"].includes(k))));
  const filter = parsed.success ? parsed.data : {};
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug, filter }),
    trpc.systems.list.queryOptions({ project: slug }),
    trpc.structure.domains.queryOptions({ project: slug }),
    trpc.structure.phases.queryOptions({ project: slug }),
    trpc.members.list.queryOptions({ project: slug }),
    trpc.systems.latestUpdates.queryOptions({ project: slug }),
    trpc.fields.list.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <SystemsView slug={slug} current={current} filter={filter} />
    </HydrateClient>
  );
}
