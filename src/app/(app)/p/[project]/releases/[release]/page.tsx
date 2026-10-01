import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { ReleaseView } from "./release-view";

/** The progress window of a release's burn-up, in days. */
const BURNUP_DAYS = 90;

/** Parses the version search parameter, returning undefined unless it is a listed version. */
function version(value: string | string[] | undefined, latest: number | null): number | undefined {
  const n = typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : NaN;
  return latest !== null && n <= latest ? n : undefined;
}

/**
 * One release: its target and freeze state, stat tiles, category bar, the systems not done yet and
 * a burn-up chart; the Notes tab (`?tab=notes&version=`) shows its versioned release notes.
 */
export default async function ReleasePage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; release: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug, release } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "notes" ? "notes" : "overview";
  const [detail] = await prefetch(trpc.releases.get.queryOptions({ project: slug, release }), trpc.projects.get.queryOptions({ project: slug }));
  const latest = detail.latestNote?.version ?? null;
  const shown = tab === "notes" ? version(sp.version, latest) : undefined;
  if (tab === "overview") await prefetch(trpc.insight.progress.queryOptions({ project: slug, filter: { release, days: BURNUP_DAYS } }));
  else if (latest !== null) await prefetch(trpc.releases.note.queryOptions({ project: slug, release, version: shown }));
  return (
    <HydrateClient>
      <ReleaseView slug={slug} releaseSlug={release} tab={tab} version={shown} burnupDays={BURNUP_DAYS} />
    </HydrateClient>
  );
}
