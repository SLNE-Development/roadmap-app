"use client";

import { useId, type ReactNode } from "react";
import type { GraphLayout } from "@/lib/graph/layout";

type LaidOutNode = GraphLayout["nodes"][number];

/** SVG graph that scrolls inside its own container. `renderNode` draws SVG content relative to the node's top-left corner. */
export function GraphView({
  layout,
  nodeHref,
  nodeLabel,
  renderNode,
  edgeClassName,
  label,
}: {
  layout: GraphLayout;
  nodeHref: (id: string) => string;
  nodeLabel?: (id: string) => string;
  renderNode: (node: LaidOutNode) => ReactNode;
  edgeClassName: (kind: string) => string;
  label: string;
}) {
  const markerId = useId();
  return (
    <div className="overflow-auto border bg-card">
      <svg
        role="group"
        aria-label={label}
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block max-w-none"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" className="fill-border" />
          </marker>
        </defs>
        {layout.edges.map((e, i) => (
          <path
            key={`${e.from}>${e.to}:${i}`}
            d={e.points.map((p, j) => `${j === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ")}
            fill="none"
            strokeWidth={1.5}
            markerEnd={`url(#${markerId})`}
            className={`stroke-border ${edgeClassName(e.kind)}`}
          />
        ))}
        {layout.nodes.map((n) => (
          <a
            key={n.id}
            href={nodeHref(n.id)}
            aria-label={nodeLabel ? nodeLabel(n.id) : n.id}
            className="focus-visible:outline-2 focus-visible:outline-ring"
          >
            <g transform={`translate(${n.x} ${n.y})`}>{renderNode(n)}</g>
          </a>
        ))}
      </svg>
    </div>
  );
}
