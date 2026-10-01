import { describe, expect, it } from "vitest";
import { layoutGraph, type GraphEdgeInput, type GraphNodeInput } from "./layout";

const node = (id: string): GraphNodeInput => ({ id, width: 200, height: 44 });
const edge = (from: string, to: string): GraphEdgeInput => ({ from, to, kind: "dep" });

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("layoutGraph", () => {
  it("places a chain left to right", () => {
    const out = layoutGraph({
      nodes: [node("A"), node("B"), node("C")],
      edges: [edge("A", "B"), edge("B", "C")],
      direction: "LR",
    });
    const x = Object.fromEntries(out.nodes.map((n) => [n.id, n.x]));
    expect(x.A).toBeLessThan(x.B);
    expect(x.B).toBeLessThan(x.C);
    expect(out.edges).toHaveLength(2);
    expect(out.edges[0].points.length).toBeGreaterThanOrEqual(2);
  });

  it("does not throw on a cycle", () => {
    const out = layoutGraph({
      nodes: [node("A"), node("B")],
      edges: [edge("A", "B"), edge("B", "A")],
      direction: "TB",
    });
    expect(out.nodes).toHaveLength(2);
  });

  it("keeps an isolated node inside the bounds", () => {
    const out = layoutGraph({
      nodes: [node("A"), node("B"), node("D")],
      edges: [edge("A", "B")],
      direction: "LR",
    });
    const d = out.nodes.find((n) => n.id === "D")!;
    expect(d.x).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThanOrEqual(0);
    expect(d.x + d.width).toBeLessThanOrEqual(out.width);
    expect(d.y + d.height).toBeLessThanOrEqual(out.height);
  });

  it("lays out 200 nodes without overlap and within bounds", () => {
    const rand = mulberry32(42);
    const nodes = Array.from({ length: 200 }, (_, i) => node(`n${i}`));
    const edges: GraphEdgeInput[] = [];
    for (let i = 0; i < 300; i++) {
      edges.push(edge(`n${Math.floor(rand() * 200)}`, `n${Math.floor(rand() * 200)}`));
    }
    const out = layoutGraph({ nodes, edges, direction: "LR" });
    expect(out.nodes).toHaveLength(200);
    for (const n of out.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width).toBeLessThanOrEqual(out.width);
      expect(n.y + n.height).toBeLessThanOrEqual(out.height);
    }
    let overlaps = 0;
    for (let i = 0; i < out.nodes.length; i++) {
      for (let j = i + 1; j < out.nodes.length; j++) {
        const a = out.nodes[i];
        const b = out.nodes[j];
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) overlaps++;
      }
    }
    expect(overlaps).toBe(0);
  });

  it("drops an edge to a missing node", () => {
    const out = layoutGraph({
      nodes: [node("A")],
      edges: [edge("A", "ghost"), edge("ghost", "A")],
      direction: "LR",
    });
    expect(out.edges).toHaveLength(0);
  });

  it("is deterministic", () => {
    const input = {
      nodes: [node("A"), node("B"), node("C"), node("D")],
      edges: [edge("A", "B"), edge("A", "C"), edge("C", "D"), edge("D", "A")],
      direction: "TB" as const,
    };
    expect(layoutGraph(input)).toEqual(layoutGraph(input));
  });
});
