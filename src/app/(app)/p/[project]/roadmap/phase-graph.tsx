"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { GraphView } from "@/components/graph/graph-view";
import { layoutGraph, type GraphEdgeInput, type GraphNodeInput } from "@/lib/graph/layout";

const NODE = { width: 220, height: 56 } as const;

/** What the graph needs of a phase row of the roadmap page. */
export type PhaseGraphRow = {
  phase: { id: string; name: string; dependsOn: string[] };
  n: string;
  total: number;
  done: number;
  complete: boolean;
  now: boolean;
};

/** Graph input of the phases: one node each, one edge from every known dependency to its dependant. */
export function phaseGraphInput(phases: { id: string; dependsOn: string[] }[]): { nodes: GraphNodeInput[]; edges: GraphEdgeInput[] } {
  const ids = new Set(phases.map((p) => p.id));
  return {
    nodes: phases.map((p) => ({ id: p.id, ...NODE })),
    edges: phases.flatMap((p) => p.dependsOn.filter((d) => ids.has(d)).map((d) => ({ from: d, to: p.id, kind: "depends" }))),
  };
}

/** Whether the phases have at least two nodes and one dependency, so a graph says more than the rail. */
export function hasPhaseDependencies(rows: PhaseGraphRow[]): boolean {
  return rows.length >= 2 && phaseGraphInput(rows.map((r) => r.phase)).edges.length > 0;
}

/**
 * The phases as a left-to-right dependency graph; a node shows number, name and done/total.
 *
 * @param props.slug the project slug
 * @param props.rows the roadmap rows, with the rail's done and now rules applied
 */
export function PhaseGraph({ slug, rows }: { slug: string; rows: PhaseGraphRow[] }) {
  const t = useTranslations("roadmap.graph");
  const byId = useMemo(() => new Map(rows.map((r) => [r.phase.id, r])), [rows]);
  const layout = useMemo(() => layoutGraph({ ...phaseGraphInput(rows.map((r) => r.phase)), direction: "LR" }), [rows]);
  return (
    <GraphView
      label={t("label")}
      layout={layout}
      nodeHref={(id) => `/p/${slug}/systems?phase=${id}`}
      nodeLabel={(id) => {
        const r = byId.get(id)!;
        return t("nodeLabel", { n: r.n, name: r.phase.name, done: r.done, total: r.total, state: r.complete ? "done" : r.now ? "now" : "none" });
      }}
      edgeClassName={() => ""}
      renderNode={({ id, width, height }) => {
        const r = byId.get(id)!;
        const bar = width - 20;
        const name = r.phase.name.length > 24 ? `${r.phase.name.slice(0, 23)}…` : r.phase.name;
        return (
          <>
            <title>{r.phase.name}</title>
            <rect
              width={width}
              height={height}
              strokeWidth={r.now ? 2 : 1.5}
              className={r.complete ? "fill-cat-done stroke-cat-done" : r.now ? "fill-card stroke-primary" : "fill-card stroke-border"}
            />
            <text x={10} y={20} className={r.complete ? "fill-background text-[12px] font-semibold" : "fill-foreground text-[12px] font-semibold"}>
              {`${r.n} ${name}`}
            </text>
            <rect x={10} y={32} width={bar} height={6} className={r.complete ? "fill-background/40" : "fill-secondary"} />
            {r.total > 0 && !r.complete && <rect x={10} y={32} width={(bar * r.done) / r.total} height={6} className="fill-primary" />}
            <text x={10} y={50} className={r.complete ? "fill-background font-mono text-[10px]" : "fill-muted-foreground font-mono text-[10px]"}>
              {r.total ? `${r.done}/${r.total}` : "–"}
            </text>
          </>
        );
      }}
    />
  );
}
