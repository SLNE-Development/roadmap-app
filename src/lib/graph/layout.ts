import dagre from "@dagrejs/dagre";

export type GraphNodeInput = { id: string; width: number; height: number };
export type GraphEdgeInput = { from: string; to: string; kind: string };
type Point = { x: number; y: number };

export type GraphLayout = {
  nodes: (GraphNodeInput & { x: number; y: number })[];
  edges: (GraphEdgeInput & { points: Point[] })[];
  width: number;
  height: number;
};

/** Layered layout; x and y are node top-left corners. Edges with a missing endpoint are dropped. */
export function layoutGraph(input: {
  nodes: GraphNodeInput[];
  edges: GraphEdgeInput[];
  direction: "LR" | "TB";
}): GraphLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: input.direction, nodesep: 24, ranksep: 56, marginx: 16, marginy: 16 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set<string>();
  for (const n of input.nodes) {
    ids.add(n.id);
    g.setNode(n.id, { width: n.width, height: n.height });
  }
  const edges = input.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);

  const nodes = input.nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, x: p.x - n.width / 2, y: p.y - n.height / 2 };
  });
  const laidOut = edges.map((e) => {
    const points = g.edge(e.from, e.to).points ?? [];
    return { ...e, points: points.map((p: Point) => ({ x: p.x, y: p.y })) };
  });
  const { width = 0, height = 0 } = g.graph();
  return { nodes, edges: laidOut, width, height };
}
