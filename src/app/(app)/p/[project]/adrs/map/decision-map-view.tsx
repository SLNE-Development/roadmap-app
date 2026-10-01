"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useTransition } from "react";
import { SegmentedLinks, withQuery } from "@/components/activity/url-tabs";
import { FilterChip, ToggleChip } from "@/components/filter-chip";
import { GraphView } from "@/components/graph/graph-view";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ADR_STATUSES, type AdrStatus, type ColumnCategory } from "@/db/schema";
import { formatAdrNumber } from "@/lib/adr-number";
import { layoutGraph } from "@/lib/graph/layout";
import type { DecisionNode } from "@/lib/ops/decisions";
import { useTRPC } from "@/trpc/client";

/** Node sizes by kind. */
const SIZE = { adr: { width: 200, height: 44 }, system: { width: 160, height: 36 }, task: { width: 180, height: 32 } } as const;

/** Border of an ADR node by status; superseded ones are dashed. */
const ADR_STROKE: Record<AdrStatus, string> = {
  proposed: "stroke-cat-review",
  accepted: "stroke-cat-done",
  superseded: "stroke-muted-foreground [stroke-dasharray:4_3]",
};

/** Fill of a system node's category dot. */
const CATEGORY_FILL: Record<ColumnCategory, string> = {
  planning: "fill-cat-planning",
  todo: "fill-cat-todo",
  active: "fill-cat-active",
  review: "fill-cat-review",
  blocked: "fill-cat-blocked",
  done: "fill-cat-done",
};

/** Edge looks by kind: supersedes solid, links dashed. `GraphView` merges these over its base `stroke-border`. */
const EDGE: Record<string, string> = {
  supersedes: "stroke-fg-2",
  concerns: "[stroke-dasharray:5_4]",
  task: "[stroke-dasharray:5_4]",
};

/** Cuts `text` to `max` characters with an ellipsis. */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The target of a node: the ADR, the system, or the task on its system's overview. */
function hrefOf(base: string, n: DecisionNode): string {
  if (n.kind === "adr") return `${base}/adrs/${n.number}`;
  if (n.kind === "system") return `${base}/systems/${n.slug}`;
  return `${base}/systems/${n.systemSlug}?tab=overview#task-${n.taskId}`;
}

/** The accessible name of a node. */
function labelOf(t: ReturnType<typeof useTranslations<"adrs.map">>, n: DecisionNode): string {
  if (n.kind === "adr") return `ADR-${formatAdrNumber(n.number)} ${n.title}`;
  if (n.kind === "system") return t("nodeSystem", { title: n.title });
  return t("nodeTask", { id: n.taskId, title: n.title });
}

/**
 * The decision map page body: the filters and the graph, or an empty state.
 *
 * @param props.slug the project slug
 * @param props.systems whether systems are shown
 * @param props.tasks whether tasks are shown
 * @param props.status only ADRs of this status
 */
export function DecisionMapView({ slug, systems, tasks, status }: { slug: string; systems: boolean; tasks: boolean; status: AdrStatus | undefined }) {
  const t = useTranslations("adrs.map");
  const tl = useTranslations("adrs");
  const te = useTranslations("enums.adrStatus");
  const trpc = useTRPC();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [{ data: graph }, { data: detail }] = useSuspenseQueries({
    queries: [trpc.adrs.graph.queryOptions({ project: slug, filter: { systems, tasks, status } }), trpc.projects.get.queryOptions({ project: slug })],
  });
  const base = `/p/${slug}`;
  const path = `${base}/adrs/map`;
  const query = { systems: systems ? undefined : "0", tasks: tasks ? "1" : undefined, status };
  /** Replaces the URL with the current query changed by `patch`. */
  const go = (patch: Record<string, string | null>) => startTransition(() => router.replace(withQuery(path, query, patch), { scroll: false }));

  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const layout = useMemo(
    () => layoutGraph({ nodes: graph.nodes.map((n) => ({ id: n.id, ...SIZE[n.kind] })), edges: graph.edges, direction: "LR" }),
    [graph],
  );

  return (
    <Page width="wide">
      <PageHeader
        crumbs={[
          { label: detail.project.name, href: base },
          { label: tl("title"), href: `${base}/adrs` },
        ]}
        title={t("title")}
        description={t("description")}
        actions={
          <SegmentedLinks
            label={tl("view.label")}
            items={[
              { label: tl("view.list"), href: `${base}/adrs`, active: false },
              { label: tl("view.map"), href: path, active: true },
            ]}
          />
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <ToggleChip label={t("systems")} on={systems} onChange={(on) => go({ systems: on ? null : "0" })} />
        <ToggleChip label={t("tasks")} on={tasks} onChange={(on) => go({ tasks: on ? "1" : null })} />
        <FilterChip label={t("status")} value={status ?? ""} options={ADR_STATUSES.map((s) => ({ value: s, label: te(s) }))} onChange={(v) => go({ status: v || null })} />
      </div>
      {graph.nodes.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title={status ? t("emptyStatusTitle") : tl("emptyTitle")}
          description={status ? t("emptyStatusDescription") : t("emptyDescription")}
          action={
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/adrs`}>{t("backToList")}</Link>
            </Button>
          }
        />
      ) : (
        <GraphView
          label={t("title")}
          layout={layout}
          nodeHref={(id) => hrefOf(base, byId.get(id)!)}
          nodeLabel={(id) => labelOf(t, byId.get(id)!)}
          edgeClassName={(kind) => EDGE[kind] ?? ""}
          renderNode={({ id, width, height }) => {
            const n = byId.get(id)!;
            if (n.kind === "adr") {
              const label = `ADR-${formatAdrNumber(n.number)}`;
              return (
                <>
                  <title>{`${label} ${n.title}`}</title>
                  <rect width={width} height={height} strokeWidth={1.5} className={`fill-card ${ADR_STROKE[n.status]}`} />
                  <text x={10} y={17} className="fill-muted-foreground font-mono text-[11px]">
                    {label}
                  </text>
                  <text x={10} y={34} className="fill-foreground text-[12px] font-medium">
                    {clip(n.title, 28)}
                  </text>
                </>
              );
            }
            if (n.kind === "system") {
              return (
                <>
                  <title>{n.title}</title>
                  <rect width={width} height={height} className="fill-secondary stroke-border" />
                  <circle cx={14} cy={height / 2} r={4} className={CATEGORY_FILL[n.category]} />
                  <text x={26} y={height / 2 + 4} className="fill-foreground text-[12px]">
                    {clip(n.title, 20)}
                  </text>
                </>
              );
            }
            return (
              <>
                <title>{n.title}</title>
                <rect width={width} height={height} className="fill-card stroke-border" />
                <text x={10} y={height / 2 + 4} className="fill-fg-2 text-[11px]">
                  {clip(`#${n.taskId} ${n.title}`, 26)}
                </text>
              </>
            );
          }}
        />
      )}
    </Page>
  );
}
