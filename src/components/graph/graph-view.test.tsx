import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GraphView } from "./graph-view";

const layout = {
  nodes: [
    { id: "a", width: 10, height: 10, x: 0, y: 0 },
    { id: "b", width: 10, height: 10, x: 40, y: 0 },
  ],
  edges: [
    { from: "a", to: "b", kind: "supersedes", points: [{ x: 10, y: 5 }, { x: 40, y: 5 }] },
    { from: "b", to: "a", kind: "other", points: [{ x: 40, y: 5 }, { x: 10, y: 5 }] },
  ],
  width: 60,
  height: 20,
};

describe("GraphView", () => {
  it("lets an edge class replace the base stroke instead of competing with it", () => {
    const html = renderToStaticMarkup(
      <GraphView layout={layout} nodeHref={() => "#"} renderNode={() => null} edgeClassName={(k) => (k === "supersedes" ? "stroke-fg-2" : "")} label="g" />,
    );
    const classes = [...html.matchAll(/<path[^>]*d="M[^"]*"[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(classes.filter((c) => c.startsWith("stroke-"))).toEqual(["stroke-fg-2", "stroke-border"]);
  });
});
