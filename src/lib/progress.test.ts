import { describe, expect, it } from "vitest";
import { categoryProgress } from "./progress";

describe("categoryProgress", () => {
  it("returns the rounded share of systems in done columns", () => {
    expect(categoryProgress([])).toBe(0);
    expect(categoryProgress([{ columnCategory: "done" }, { columnCategory: "active" }, { columnCategory: "planning" }])).toBe(33);
    expect(categoryProgress([{ columnCategory: "done" }])).toBe(100);
  });
});
