import { describe, expect, it } from "vitest";
import { parseRefs } from "./refs";

describe("parseRefs", () => {
  it.each([
    ["feat: search [roadmap#188 roadmap#189]", [188, 189]],
    ["Roadmap#7 and roadmap#7", [7]],
    ["fixes #188", []],
    ["see foo/roadmap#12", []],
    ["xroadmap#3", []],
    ["roadmap#1234567890", []],
  ])("finds the tasks in %j", (text, tasks) => {
    expect(parseRefs(text).tasks).toEqual(tasks);
  });

  it.each([
    ["roadmap:search-index.", ["search-index"]],
    ["roadmap:Search-Index", ["search-index"]],
    ["roadmap:search--index", []],
    ["roadmap:-x", []],
    ["roadmap:" + "a".repeat(65), []],
    ["https://x.com/roadmap:abc", []],
  ])("finds the systems in %j", (text, systems) => {
    expect(parseRefs(text).systems).toEqual(systems);
  });

  it("keeps the first-seen order of mixed references", () => {
    expect(parseRefs("roadmap:b roadmap#2 roadmap:a roadmap#1 roadmap:B")).toEqual({ tasks: [2, 1], systems: ["b", "a"] });
  });
});
