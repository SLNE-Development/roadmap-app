import { parseTab } from "@/components/system/tabs";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { SystemView } from "./system-view";

/** Parses a version search parameter, returning undefined unless it is a listed version. */
function version(value: string | string[] | undefined, known: number[] | undefined): number | undefined {
  const n = typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : NaN;
  return known?.includes(n) ? n : undefined;
}

/**
 * One system: crumbs, title with status, primary move and overflow menu, the
 * meta line and summary, then tabs (`?tab=`): Overview (tasks and spec preview
 * with a rail of properties, planning, decisions and notes), Spec, Plan,
 * Planning and Activity. Phones get a 2×2 fact grid, pill tabs and a fixed
 * bottom bar with the status and the primary move.
 */
export default async function SystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; system: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug, system: systemSlug } = await params;
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const ref = { project: slug, system: systemSlug };
  const [overview] = await prefetch(trpc.systems.overview.queryOptions(ref));
  const specVersion = tab === "spec" ? version(sp.spec, overview.spec?.versions) : undefined;
  const planVersion = tab === "plan" ? version(sp.plan, overview.plan?.versions) : undefined;
  await Promise.all([
    prefetch(
      trpc.planning.get.queryOptions(ref),
      trpc.history.activity.queryOptions({ project: slug, filter: { system: systemSlug, limit: 300 } }),
      trpc.members.list.queryOptions({ project: slug }),
      trpc.structure.domains.queryOptions({ project: slug }),
      trpc.structure.phases.queryOptions({ project: slug }),
    ),
    specVersion && prefetch(trpc.history.document.queryOptions({ ...ref, kind: "spec", version: specVersion })),
    planVersion && prefetch(trpc.history.document.queryOptions({ ...ref, kind: "plan", version: planVersion })),
  ]);

  return (
    <HydrateClient>
      <SystemView projectSlug={slug} systemSlug={systemSlug} tab={tab} specVersion={specVersion} planVersion={planVersion} />
    </HydrateClient>
  );
}
