import { describe, expect, it } from "vitest";
import { phaseGraphInput } from "./phase-graph";

describe("phaseGraphInput", () => {
  const phases = [
    { id: "p1", dependsOn: [] },
    { id: "p2", dependsOn: ["p1"] },
    { id: "p3", dependsOn: ["p1", "p2"] },
  ];

  it("points every edge from the dependency to the dependant and sizes nodes 220x56", () => {
    const { nodes, edges } = phaseGraphInput(phases);
    expect(edges.map((e) => `${e.from}>${e.to}`)).toEqual(["p1>p2", "p1>p3", "p2>p3"]);
    expect(nodes).toHaveLength(3);
    for (const n of nodes) expect(n).toMatchObject({ width: 220, height: 56 });
  });

  it("drops a dependency on an unknown phase", () => {
    const { edges } = phaseGraphInput([{ id: "p1", dependsOn: ["gone"] }, { id: "p2", dependsOn: ["p1"] }]);
    expect(edges.map((e) => `${e.from}>${e.to}`)).toEqual(["p1>p2"]);
  });
});
