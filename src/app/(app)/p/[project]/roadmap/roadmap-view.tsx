"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Check, Milestone } from "lucide-react";
import Link from "next/link";
import { SegmentedLinks } from "@/components/activity/url-tabs";
import { CategoryDot } from "@/components/chips";
import { EmptyState, Page, PageHeader, Panel, ProgressBar } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { SystemListItem } from "@/lib/ops/systems";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { ProgressView, type ProgressParams } from "./progress-view";

/** The views of the roadmap page; `graph` shows the rail until the dependency graph exists. */
export type RoadmapMode = "rail" | "graph" | "progress";

/** The tabs of the view switch and the `?view=` value each one sets. */
const VIEWS = [
  { value: "rail", label: "Rail" },
  { value: "graph", label: "Graph" },
  { value: "progress", label: "Progress" },
] as const;

/** Zero-pads a phase's position to two digits, "01". */
function phaseNumber(index: number): string {
  return String(index + 1).padStart(2, "0");
}

/** A square system chip with its category dot, linking to the system. */
function SystemChip({ system, projectSlug }: { system: SystemListItem; projectSlug: string }) {
  return (
    <Link
      href={`/p/${projectSlug}/systems/${system.slug}`}
      className="flex h-7 items-center gap-[7px] border bg-background px-2.5 text-[13px] transition-colors hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <CategoryDot category={system.columnCategory} className="size-[7px]" />
      <span className="sr-only">{system.columnName}:</span>
      {system.title}
    </Link>
  );
}

/**
 * Phase roadmap: a rail of phases in order with their goal, dependencies,
 * systems and progress; the first phase not fully done is "now".
 *
 * @param props.slug the project slug
 * @param props.mode which view to show
 * @param props.progress the URL filters of the Progress view
 */
export function RoadmapView({ slug, mode, progress }: { slug: string; mode: RoadmapMode; progress: ProgressParams }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: phases }, { data: systems }, { data: phaseRollups }] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.structure.phases.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
      trpc.structure.phaseRollups.queryOptions({ project: slug }),
    ],
  });
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  const rollupOf = new Map(phaseRollups.map((r) => [r.phaseId, r]));
  const rows = phases.map((p, i) => {
    const items = systems.filter((s) => s.phaseId === p.id);
    const done = items.filter((s) => s.columnCategory === "done").length;
    return { phase: p, n: phaseNumber(i), items, done, rollup: rollupOf.get(p.id), complete: items.length > 0 && done === items.length };
  });
  const nowIndex = rows.findIndex((r) => !r.complete);
  const byId = new Map(rows.map((r) => [r.phase.id, r]));
  const unphased = systems.filter((s) => !s.phaseId || !byId.has(s.phaseId));
  const doneCount = systems.filter((s) => s.columnCategory === "done").length;
  const editPhases = canEdit && (
    <Button variant="outline" asChild>
      <Link href={`/p/${slug}/settings/structure`}>Edit phases</Link>
    </Button>
  );

  return (
    <Page width="full">
      <PageHeader
        crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]}
        title="Roadmap"
        actions={
          <>
            <SegmentedLinks
              label="View"
              items={VIEWS.map((v) => ({
                label: v.label,
                href: v.value === "rail" ? `/p/${slug}/roadmap` : `/p/${slug}/roadmap?view=${v.value}`,
                active: v.value === mode,
              }))}
            />
            {mode !== "progress" && rows.length > 0 && (
              <span className="text-[13px] text-fg-2">
                {nowIndex >= 0 ? (
                  <>
                    Now in <b className="font-semibold text-foreground">{rows[nowIndex].phase.name}</b> ·{" "}
                  </>
                ) : (
                  "Every phase is done · "
                )}
                {doneCount} of {systems.length} systems done
              </span>
            )}
            {editPhases}
          </>
        }
      />
      {mode === "progress" ? (
        <ProgressView slug={slug} params={progress} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Milestone />}
          title="No phases yet"
          description="Phases order the work into milestones. Add them in settings, or let an agent create them with create_phase."
          action={editPhases}
        />
      ) : (
        <ol className="flex flex-col border bg-card">
          {rows.map((r, i) => {
            const now = i === nowIndex;
            const past = nowIndex < 0 || i < nowIndex;
            const deps = r.phase.dependsOn.map((id) => byId.get(id)).filter((d) => d !== undefined);
            return (
              <li
                key={r.phase.id}
                className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-4 border-b pr-4 last:border-b-0 sm:pr-5 lg:grid-cols-[44px_minmax(0,290px)_minmax(0,1fr)_150px]"
              >
                <div className="relative row-span-3 flex justify-center lg:row-span-1">
                  <span aria-hidden className={cn("absolute inset-y-0 left-[21px] w-0.5", past ? "bg-cat-done" : "bg-border")} />
                  <span
                    aria-hidden
                    className={cn(
                      "relative mt-[18px] size-3 rounded-full",
                      r.complete ? "bg-cat-done" : now ? "border-[3px] border-primary bg-card" : "border-2 border-border bg-card",
                    )}
                  />
                </div>
                <div className="flex flex-col gap-[3px] pt-3.5 lg:py-3.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[11.5px] text-muted-foreground">{r.n}</span>
                    <span className="text-[14.5px] font-semibold">{r.phase.name}</span>
                    {now && <span className="bg-brand-soft px-1.5 py-px text-[11px] font-bold text-brand-strong">NOW</span>}
                    {r.complete && <span className="sr-only">(done)</span>}
                  </div>
                  {r.phase.goal && <span className="text-[12.5px] leading-[1.45] text-fg-2">{r.phase.goal}</span>}
                  {r.rollup && r.rollup.tasks > 0 && (
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {r.rollup.points > 0 && `${r.rollup.pointsDone}/${r.rollup.points} pts · `}
                      {r.rollup.done}/{r.rollup.tasks} tasks done
                    </span>
                  )}
                  {deps.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      Builds on {deps.map((d) => `${d.n} ${d.phase.name}`).join(", ").replace(/, ([^,]*)$/, " and $1")}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap content-center gap-1.5 py-3">
                  {r.items.length > 0 ? (
                    r.items.map((s) => <SystemChip key={s.id} system={s} projectSlug={slug} />)
                  ) : (
                    <span className="text-[12.5px] text-muted-foreground">No systems yet</span>
                  )}
                </div>
                <div className="flex items-center gap-2.5 pb-3.5 lg:pb-0">
                  <ProgressBar
                    value={r.done}
                    total={r.items.length}
                    colorClass={r.complete ? "bg-cat-done" : "bg-primary"}
                    className="h-1.5"
                  />
                  <span className="w-[30px] text-right font-mono text-xs text-fg-2">{r.items.length ? `${r.done}/${r.items.length}` : "–"}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {mode !== "progress" &&
        systems.length > 0 &&
        (unphased.length > 0 ? (
          <Panel title="Without a phase" meta={`${unphased.length} ${unphased.length === 1 ? "system" : "systems"}`} bodyClassName="px-4 pb-4 sm:px-5">
            <div className="flex flex-wrap gap-1.5">
              {unphased.map((s) => (
                <SystemChip key={s.id} system={s} projectSlug={slug} />
              ))}
            </div>
          </Panel>
        ) : (
          rows.length > 0 && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Check aria-hidden className="size-3.5" />
              Every system has a phase.
            </p>
          )
        ))}
    </Page>
  );
}
