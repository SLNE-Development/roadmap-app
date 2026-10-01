import { describe, expect, it } from "vitest";
import { resolvePanels } from "./overview-panels";

describe("resolvePanels", () => {
  it("defaults to the standard order, all visible", () => {
    const all = [
      { id: "status", visible: true },
      { id: "attention", visible: true },
      { id: "phases", visible: true },
      { id: "updates", visible: true },
    ];
    expect(resolvePanels(null)).toEqual(all);
    expect(resolvePanels("junk")).toEqual(all);
    expect(resolvePanels({ order: "x", hidden: [] })).toEqual(all);
  });

  it("drops unknown ids and appends missing panels", () => {
    expect(resolvePanels({ order: ["updates", "bogus", "status"], hidden: ["status"] })).toEqual([
      { id: "updates", visible: true },
      { id: "status", visible: false },
      { id: "attention", visible: true },
      { id: "phases", visible: true },
    ]);
  });

  it("ignores duplicate ids", () => {
    expect(resolvePanels({ order: ["phases", "phases"], hidden: [] }).map((p) => p.id)).toEqual(["phases", "status", "attention", "updates"]);
  });
});
