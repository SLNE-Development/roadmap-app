"use client";

import { useMutation, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { Lock, LockOpen } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { UnderlineTabs } from "@/components/activity/url-tabs";
import { CATEGORY_CLASS, CATEGORY_LABEL, StatusChip } from "@/components/chips";
import { useNow } from "@/components/clock";
import { BurnupChart } from "@/components/insight/burnup-chart";
import { finishText } from "@/components/insight/stat-tiles";
import { Page, PageHeader, Panel } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { DeleteReleaseDialog } from "@/components/releases/delete-release-dialog";
import { EditReleaseDialog } from "@/components/releases/edit-release-dialog";
import { ReleaseRiskChip, ReleaseStatusChip } from "@/components/releases/release-chips";
import { ReleaseNotes } from "@/components/releases/release-notes";
import { ShipReleaseDialog } from "@/components/releases/ship-release-dialog";
import { Button } from "@/components/ui/button";
import { COLUMN_CATEGORIES } from "@/db/schema";
import type { ReleaseSystem } from "@/lib/ops/releases";
import { plural } from "@/lib/text";
import { daysUntil, formatDate } from "@/lib/time";
import { useTRPC } from "@/trpc/client";

/** One big number with a caption and an optional chip. */
function Tile({ value, caption, children }: { value: string; caption: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border bg-card px-4 py-3.5">
      <span className="text-[22px] leading-tight font-semibold tabular-nums">{value}</span>
      <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
        {caption}
        {children}
      </span>
    </div>
  );
}

/** What is left for a system: its open tasks, or the Done rules it still misses. */
function detailLine(s: ReleaseSystem): string {
  if (s.tasksDone < s.tasksTotal) return `${s.tasksDone} of ${plural(s.tasksTotal, "task")} done`;
  if (s.gatesTotal > 0 && s.gatesUnmet > 0) return `${s.gatesTotal - s.gatesUnmet} of ${s.gatesTotal} Done rules met`;
  return s.tasksTotal > 0 ? `${plural(s.tasksTotal, "task")} done` : "No tasks yet";
}

/** The countdown to a target date: days left, due today or days overdue. */
function countdown(target: string, now: Date): string {
  const days = daysUntil(target, now);
  if (days > 0) return `${plural(days, "day")} left`;
  return days === 0 ? "Due today" : `${plural(-days, "day")} overdue`;
}

/**
 * A release page: target and freeze state, tiles, category bar, the systems not done yet and the burn-up
 * on the overview tab, the versioned release notes on the other. Editors edit a planned release; owners also
 * edit a frozen one, freeze, unfreeze and ship, and delete a planned one.
 *
 * @param props.tab the open tab
 * @param props.version the notes version to show, the latest when undefined
 * @param props.burnupDays the window of the burn-up in days
 */
export function ReleaseView({
  slug,
  releaseSlug,
  tab,
  version,
  burnupDays,
}: {
  slug: string;
  releaseSlug: string;
  tab: "overview" | "notes";
  version: number | undefined;
  burnupDays: 90;
}) {
  const trpc = useTRPC();
  const now = useNow();
  const ref = { project: slug, release: releaseSlug };
  const [{ data: detail }, { data: project }] = useSuspenseQueries({
    queries: [trpc.releases.get.queryOptions(ref), trpc.projects.get.queryOptions({ project: slug })],
  });
  const { release: r, systems, counts, openQuestions, risk, projection, frozenBy, latestNote } = detail;
  const progress = useQuery({
    ...trpc.insight.progress.queryOptions({ project: slug, filter: { release: releaseSlug, days: burnupDays } }),
    enabled: tab === "overview",
  });
  const freeze = useMutation(trpc.releases.freeze.mutationOptions());
  const unfreeze = useMutation(trpc.releases.unfreeze.mutationOptions());

  const active = !project.project.archivedAt;
  const canEdit = project.role !== "viewer" && active;
  const isOwner = (project.role === "owner" || project.role === "admin") && active;
  const canEditRelease = r.status === "planned" ? canEdit : r.status === "frozen" && isOwner;
  const base = `/p/${slug}/releases/${releaseSlug}`;
  const notDone = systems.filter((s) => s.category !== "done");
  const shownCategories = COLUMN_CATEGORIES.filter((c) => counts[c] > 0);
  const target = r.targetDate ? `target ${formatDate(`${r.targetDate}T00:00:00Z`, now)}` : "no target date";
  const state = [
    r.status === "frozen" && r.frozenAt ? `Frozen ${formatDate(new Date(r.frozenAt).toISOString(), now)}${frozenBy ? ` by ${frozenBy}` : ""}` : null,
    r.status === "shipped" && r.shippedAt ? `Shipped ${formatDate(new Date(r.shippedAt).toISOString(), now)}` : null,
    r.status !== "shipped" && r.targetDate ? countdown(r.targetDate, now) : null,
  ].filter(Boolean);

  const actions = (
    <>
      <ReleaseStatusChip status={r.status} />
      {canEditRelease && <EditReleaseDialog projectSlug={slug} release={{ slug: r.slug, name: r.name, targetDate: r.targetDate }} />}
      {isOwner && r.status === "planned" && <DeleteReleaseDialog projectSlug={slug} releaseSlug={releaseSlug} releaseName={r.name} />}
      {isOwner && r.status === "planned" && (
        <Button variant="outline" disabled={freeze.isPending} onClick={() => freeze.mutate(ref, { onSuccess: () => toast.success(`Froze ${r.name}`) })}>
          <Lock aria-hidden />
          Freeze
        </Button>
      )}
      {isOwner && r.status === "frozen" && (
        <Button variant="outline" disabled={unfreeze.isPending} onClick={() => unfreeze.mutate(ref, { onSuccess: () => toast.success(`Unfroze ${r.name}`) })}>
          <LockOpen aria-hidden />
          Unfreeze
        </Button>
      )}
      {isOwner && r.status !== "shipped" && (
        <ShipReleaseDialog projectSlug={slug} releaseSlug={releaseSlug} releaseName={r.name} unfinished={notDone.map((s) => s.title)} />
      )}
    </>
  );

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: project.project.name, href: `/p/${slug}` }, { label: "Releases", href: `/p/${slug}/releases` }, { label: r.name }]}
        title={r.name}
        description={
          <>
            <p>
              {r.name} · {target}
            </p>
            {state.length > 0 && <p>{state.join(" · ")}</p>}
          </>
        }
        actions={actions}
      />
      <UnderlineTabs
        label="Release sections"
        tabs={[
          { label: "Overview", href: base, active: tab === "overview" },
          { label: "Notes", href: `${base}?tab=notes`, active: tab === "notes" },
        ]}
      />
      {tab === "notes" ? (
        <ReleaseNotes projectSlug={slug} releaseSlug={releaseSlug} latest={latestNote?.version ?? null} version={version} canEdit={canEdit} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile value={`${counts.done} / ${systems.length}`} caption="systems done" />
            <Tile value={String(openQuestions.length)} caption="open questions" />
            <Tile value={finishText(projection)} caption="projected finish">
              <ReleaseRiskChip risk={risk} />
            </Tile>
          </div>
          {systems.length > 0 && (
            <div className="flex flex-col gap-2">
              <div role="img" aria-label={shownCategories.map((c) => `${counts[c]} ${CATEGORY_LABEL[c]}`).join(", ")} className="flex h-2 bg-secondary">
                {shownCategories.map((c) => (
                  <span key={c} className={CATEGORY_CLASS[c]} style={{ width: `${(100 * counts[c]) / systems.length}%` }} />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-2">
                {shownCategories.map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <span aria-hidden className={`size-2 ${CATEGORY_CLASS[c]}`} />
                    {CATEGORY_LABEL[c]} {counts[c]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Panel title="Not done yet" meta={systems.length === 0 ? undefined : `${notDone.length} of ${plural(systems.length, "system")}`} bodyClassName="pb-2">
            {systems.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground sm:px-5">No systems yet. Assign systems to this release from their page.</p>
            ) : notDone.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground sm:px-5">Everything in this release is done.</p>
            ) : (
              <ul>
                {notDone.map((s) => (
                  <li key={s.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-[13.5px] sm:px-5">
                    <Link href={`/p/${slug}/systems/${s.slug}`} className="min-w-0 flex-1 truncate font-semibold hover:underline focus-visible:underline focus-visible:outline-none">
                      {s.title}
                    </Link>
                    <StatusChip category={s.category} name={CATEGORY_LABEL[s.category]} />
                    <span className="text-[12.5px] text-fg-2">{detailLine(s)}</span>
                    <span className="min-w-24 text-[12.5px] text-fg-2">
                      {s.ownerName ? <PersonName name={s.ownerName} size="sm" className="gap-2" /> : <span className="text-muted-foreground">Unowned</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Burn-up" bodyClassName="px-4 pb-4 sm:px-5">
            {progress.data && progress.data.points.length > 0 ? (
              <BurnupChart points={progress.data.points} projection={progress.data.projection} />
            ) : (
              <p className="text-[13px] text-muted-foreground">{progress.isPending ? "Loading…" : "No tasks yet."}</p>
            )}
          </Panel>
        </>
      )}
    </Page>
  );
}
