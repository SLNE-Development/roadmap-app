"use client";

import { useQueries, useSuspenseQueries } from "@tanstack/react-query";
import { Rocket } from "lucide-react";
import Link from "next/link";
import { CATEGORY_CLASS } from "@/components/chips";
import { EmptyState, Page, PageHeader, ProgressBar } from "@/components/page";
import { NewReleaseDialog } from "@/components/releases/new-release-dialog";
import { ReleaseRiskChip, ReleaseStatusChip } from "@/components/releases/release-chips";
import { useNow } from "@/components/clock";
import { formatDate } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/** Classes of the grid shared by the header and every row. */
const GRID = "grid grid-cols-[minmax(0,2fr)_100px_100px_minmax(120px,1fr)_110px] items-center gap-4";

/**
 * The releases list: a table of releases by target date with status, done of total systems and slip
 * risk. Editors get a "New release" button; with none yet the page explains what a release is.
 *
 * @param props.slug the project slug
 */
export function ReleasesView({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const now = useNow();
  const [{ data: detail }, { data: releases }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.releases.list.queryOptions({ project: slug })],
  });
  // Slip risk comes with each open release's detail; shipped releases have none to show.
  const open = releases.filter((r) => r.status !== "shipped");
  const risks = useQueries({ queries: open.map((r) => trpc.releases.get.queryOptions({ project: slug, release: r.slug })) });
  const riskOf = new Map(open.map((r, i) => [r.id, risks[i].data?.risk]));
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  const newRelease = canEdit && <NewReleaseDialog projectSlug={slug} />;

  return (
    <Page>
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title="Releases" actions={newRelease}>
        {releases.length > 0 && <p className="text-sm text-fg-2">Groups of systems that ship together.</p>}
      </PageHeader>
      {releases.length === 0 ? (
        <EmptyState
          icon={<Rocket />}
          title="No releases yet"
          description="Releases group systems that ship together. Create one, then assign systems from their page."
          action={newRelease}
        />
      ) : (
        <div className="overflow-x-auto border bg-card">
          <div role="table" aria-label="Releases" className="flex min-w-[640px] flex-col">
            <div role="rowgroup">
              <div role="row" className={`${GRID} border-b px-4 py-[9px] text-xs font-semibold text-muted-foreground`}>
                <span role="columnheader">Release</span>
                <span role="columnheader">Target</span>
                <span role="columnheader">Status</span>
                <span role="columnheader">Done</span>
                <span role="columnheader">Risk</span>
              </div>
            </div>
            <div role="rowgroup">
              {releases.map((r) => (
                <div role="row" key={r.id} className={`${GRID} relative border-b px-4 py-2.5 text-[13.5px] last:border-b-0 hover:bg-muted/50`}>
                  <span role="cell" className="min-w-0">
                    <Link
                      href={`/p/${slug}/releases/${r.slug}`}
                      data-nav-item
                      className="truncate font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                    >
                      {r.name}
                    </Link>
                  </span>
                  <span role="cell" className="text-fg-2">
                    {r.targetDate ? formatDate(`${r.targetDate}T00:00:00Z`, now) : <span className="text-muted-foreground">—</span>}
                  </span>
                  <span role="cell">
                    <ReleaseStatusChip status={r.status} />
                  </span>
                  <span role="cell" className="flex items-center gap-2">
                    <ProgressBar value={r.doneCount} total={r.systemCount} colorClass={CATEGORY_CLASS.done} className="w-20 flex-none" />
                    <span className="font-mono text-xs text-muted-foreground">
                      {r.doneCount}/{r.systemCount}
                    </span>
                  </span>
                  <span role="cell">
                    {riskOf.get(r.id) ? <ReleaseRiskChip risk={riskOf.get(r.id)!} /> : <span className="text-muted-foreground">—</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}
