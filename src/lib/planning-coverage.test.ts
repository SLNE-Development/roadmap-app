import { describe, expect, it } from "vitest";
import { PLANNING_AREAS } from "@/db/schema";
import { planningCoverage } from "./planning-coverage";

type Item = Parameters<typeof planningCoverage>[0][number];

/** Builds `n` items of one area with a status and risk flag. */
function items(area: Item["area"], status: Item["status"], n: number, isRisk = false): Item[] {
  return Array.from({ length: n }, () => ({ area, status, isRisk }));
}

describe("planningCoverage", () => {
  it("reports every area as thin when nothing was asked", () => {
    const coverage = planningCoverage([]);
    expect(coverage).toHaveLength(4);
    for (const c of coverage) {
      expect(c).toMatchObject({ asked: 0, thin: true, reason: "No questions asked yet." });
    }
  });

  it("counts asked, answered and open items", () => {
    const scope = planningCoverage([...items("scope", "answered", 2), ...items("scope", "open", 1)]).find((c) => c.area === "scope");
    expect(scope).toMatchObject({ asked: 3, answered: 2, open: 1, thin: false, reason: null });
  });

  it("is thin with fewer than two settled questions", () => {
    const dependencies = planningCoverage(items("dependencies", "answered", 1)).find((c) => c.area === "dependencies");
    expect(dependencies).toMatchObject({ thin: true, reason: "Only 1 settled question; ask at least 2." });
  });

  it("uses the plural for zero settled questions", () => {
    const dependencies = planningCoverage(items("dependencies", "open", 1)).find((c) => c.area === "dependencies");
    expect(dependencies?.reason).toBe("Only 0 settled questions; ask at least 2.");
  });

  it("requires a flagged risk among the failure modes", () => {
    const without = planningCoverage(items("failure-modes", "answered", 3)).find((c) => c.area === "failure-modes");
    expect(without).toMatchObject({ thin: true, reason: "No failure mode is flagged as a risk." });
    const withRisk = planningCoverage([...items("failure-modes", "answered", 2), ...items("failure-modes", "answered", 1, true)]).find((c) => c.area === "failure-modes");
    expect(withRisk).toMatchObject({ thin: false, reason: null, risks: 1 });
  });

  it("counts accepted risks as settled", () => {
    const failure = planningCoverage([...items("failure-modes", "accepted-risk", 2, true)]).find((c) => c.area === "failure-modes");
    expect(failure).toMatchObject({ acceptedRisk: 2, answered: 0, thin: false });
  });

  it("returns the areas in schema order", () => {
    expect(planningCoverage([]).map((c) => c.area)).toEqual([...PLANNING_AREAS]);
  });
});
