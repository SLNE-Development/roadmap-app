import { parseTab } from "@/components/system/tabs";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { SystemView } from "./system-view";

/** Parses a version search parameter, returning undefined unless it is a listed version. */
function version(value: string | string[] | undefined, known: number[] | undefined): number | undefined {
  const n = typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : NaN;
  return known?.includes(n) ? n : undefined;
}

/**
 * Parses the `compare` search parameter (`from..to`) against the listed versions.
 * Any present but invalid value falls back to the last two versions; undefined without
 * the parameter or with fewer than two versions.
 */
function compare(value: string | string[] | undefined, known: number[] | undefined): { from: number; to: number } | undefined {
  if (value === undefined || !known || known.length < 2) return undefined;
  const m = typeof value === "string" ? /^([1-9]\d{0,8})\.\.([1-9]\d{0,8})$/.exec(value) : null;
  const from = m ? Number(m[1]) : NaN;
  const to = m ? Number(m[2]) : NaN;
  if (known.includes(from) && known.includes(to) && from < to) return { from, to };
  return { from: known[1], to: known[0] };
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
  const specCompare = tab === "spec" ? compare(sp.compare, overview.spec?.versions) : undefined;
  const planCompare = tab === "plan" ? compare(sp.compare, overview.plan?.versions) : undefined;
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
    specCompare && prefetch(trpc.history.compare.queryOptions({ ...ref, kind: "spec", ...specCompare })),
    planCompare && prefetch(trpc.history.compare.queryOptions({ ...ref, kind: "plan", ...planCompare })),
  ]);

  return (
    <HydrateClient>
      <SystemView
        projectSlug={slug}
        systemSlug={systemSlug}
        tab={tab}
        specVersion={specVersion}
        planVersion={planVersion}
        specCompare={specCompare}
        planCompare={planCompare}
      />
    </HydrateClient>
  );
}
