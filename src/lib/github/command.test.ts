import { describe, expect, it } from "vitest";
import { parseRoadmapCommand } from "./command";

describe("parseRoadmapCommand", () => {
  it("accepts a bare command", () => {
    expect(parseRoadmapCommand("/roadmap")).toEqual({ query: "" });
  });

  it("reads the query from the first non-blank line", () => {
    expect(parseRoadmapCommand("\n  /Roadmap search index \nmore")).toEqual({ query: "search index" });
  });

  it("cuts the query to 200 characters", () => {
    expect(parseRoadmapCommand(`/roadmap ${"x".repeat(300)}`)?.query).toHaveLength(200);
  });

  it("rejects other text", () => {
    expect(parseRoadmapCommand("/roadmapper")).toBeNull();
    expect(parseRoadmapCommand("hi /roadmap")).toBeNull();
    expect(parseRoadmapCommand("")).toBeNull();
  });
});
