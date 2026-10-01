import { describe, expect, it } from "vitest";
import { stepNumberOf, stepStates } from "./plan-steps";

describe("stepNumberOf", () => {
  it("reads the number of a step or task heading", () => {
    expect(stepNumberOf("Step 3: Wire the API")).toBe(3);
    expect(stepNumberOf("Task 12 - Tests")).toBe(12);
    expect(stepNumberOf("  step 1")).toBe(1);
  });

  it("ignores other headings", () => {
    expect(stepNumberOf("Steps overview")).toBeNull();
    expect(stepNumberOf("Step three")).toBeNull();
  });
});

describe("stepStates", () => {
  it("maps plan steps to their task and leaves tasks without a step out", () => {
    const states = stepStates([
      { id: 5, planStep: 2, state: "done", title: "Build" },
      { id: 6, planStep: null, state: "todo", title: "Loose" },
    ]);
    expect([...states.keys()]).toEqual([2]);
    expect(states.get(2)).toEqual({ taskId: 5, state: "done", title: "Build" });
  });
});
