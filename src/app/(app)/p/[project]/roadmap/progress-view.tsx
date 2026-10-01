"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { SegmentedLinks, withQuery } from "@/components/activity/url-tabs";
import { FilterChip } from "@/components/filter-chip";
import { BurnupChart } from "@/components/insight/burnup-chart";
import { ColumnTimes } from "@/components/insight/column-times";
import { RANGES, StatTiles } from "@/components/insight/stat-tiles";
import { Panel } from "@/components/page";
import { useTRPC } from "@/trpc/client";

/** The URL state of the Progress view; `days` is one of the {@link RANGES}. */
export interface ProgressParams {
  days: 14 | 42 | 90 | 180 | 365;
  phase?: string;
  board?: string;
  domain?: string;
  release?: string;
}

/**
 * The Progress view of the roadmap page: stat tiles, the burn-up chart and the
 * systems that have waited longest in their column category. Filters and the
 * range live in the URL.
 *
 * @param props.slug the project slug
 * @param props.params the validated URL filters
 */
export function ProgressView({ slug, params }: { slug: string; params: ProgressParams }) {
  const t = useTranslations("roadmap.progress");
  const tRange = useTranslations("insight.ranges");
  const trpc = useTRPC();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { days, phase, board, domain, release } = params;
  const [{ data: detail }, { data: phases }, { data: domains }, { data: releases }, { data: progress }, { data: times }] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.structure.phases.queryOptions({ project: slug }),
      trpc.structure.domains.queryOptions({ project: slug }),
      trpc.releases.list.queryOptions({ project: slug }),
      trpc.insight.progress.queryOptions({ project: slug, filter: { days, phase, board, domain, release } }),
      trpc.insight.columnTimes.queryOptions({ project: slug, filter: { board } }),
    ],
  });
  const path = `/p/${slug}/roadmap`;
  const query = { view: "progress", days: days === 42 ? undefined : String(days), phase, board, domain, release };
  /** Replaces the URL with the current query changed by `patch`. */
  const go = (patch: Record<string, string | null>) => startTransition(() => router.replace(withQuery(path, query, patch), { scroll: false }));
  const rangeKey = RANGES.find((r) => r.days === days)?.key;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <FilterChip label={t("phase")} value={phase ?? ""} onChange={(v) => go({ phase: v || null })} options={phases.map((p) => ({ value: p.id, label: p.name }))} />
        <FilterChip label={t("board")} value={board ?? ""} onChange={(v) => go({ board: v || null })} options={detail.boards.map((b) => ({ value: b.slug, label: b.name }))} />
        <FilterChip label={t("domain")} value={domain ?? ""} onChange={(v) => go({ domain: v || null })} options={domains.map((d) => ({ value: d.id, label: d.name }))} />
        {releases.length > 0 && (
          <FilterChip label={t("release")} value={release ?? ""} onChange={(v) => go({ release: v || null })} options={releases.map((r) => ({ value: r.slug, label: r.name }))} />
        )}
        <SegmentedLinks
          label={t("range")}
          items={RANGES.map((r) => ({ label: tRange(r.key), href: withQuery(path, query, { days: r.days === 42 ? null : String(r.days) }), active: r.days === days }))}
        />
      </div>
      <StatTiles totals={progress.totals} scopeAdded={progress.scopeAdded} projection={progress.projection} range={rangeKey ? tRange(rangeKey) : String(days)} />
      <Panel title={t("burnup")} bodyClassName="px-4 pb-4 sm:px-5">
        {progress.points.length > 0 ? (
          <BurnupChart points={progress.points} projection={progress.projection} />
        ) : (
          <p className="text-[13px] text-muted-foreground">{t("noTasks")}</p>
        )}
      </Panel>
      <Panel title={t("longest")} meta={t("topTen")} bodyClassName="pb-2">
        <ColumnTimes systems={times.systems} slug={slug} />
      </Panel>
    </>
  );
}
