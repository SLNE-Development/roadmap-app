import { describe, expect, it } from "vitest";
import { withRef } from "./pr-text";

describe("withRef", () => {
  it("adds a Roadmap line to an empty body", () => {
    expect(withRef({ title: "Fix x", body: "" }, "roadmap#5", false)).toEqual({ body: "Roadmap: roadmap#5" });
  });

  it("appends a Roadmap paragraph to a body", () => {
    expect(withRef({ title: "Fix", body: "Text" }, "roadmap#5", false)).toEqual({ body: "Text\n\nRoadmap: roadmap#5" });
  });

  it("extends an existing Roadmap line", () => {
    expect(withRef({ title: "Fix", body: "a\nRoadmap: roadmap#1\nb" }, "roadmap#5", false)).toEqual({
      body: "a\nRoadmap: roadmap#1 roadmap#5\nb",
    });
  });

  it("keeps CRLF line endings when extending a Roadmap line", () => {
    expect(withRef({ title: "Fix", body: "a\r\nRoadmap: roadmap#1\r\nb" }, "roadmap#5", false)).toEqual({
      body: "a\r\nRoadmap: roadmap#1 roadmap#5\r\nb",
    });
  });

  it("appends the Roadmap paragraph with CRLF to a CRLF body", () => {
    expect(withRef({ title: "Fix", body: "a\r\nb" }, "roadmap#5", false)).toEqual({ body: "a\r\nb\r\n\r\nRoadmap: roadmap#5" });
  });

  it("puts the ref in the title when it closes the item", () => {
    expect(withRef({ title: "Fix", body: "" }, "roadmap#5", true)).toEqual({ title: "Fix roadmap#5" });
  });

  it("returns null when the ref is already present", () => {
    expect(withRef({ title: "x ROADMAP#5", body: "" }, "roadmap#5", false)).toBeNull();
  });

  it("does not mistake a longer number for the ref", () => {
    expect(withRef({ title: "x", body: "roadmap#55" }, "roadmap#5", false)).not.toBeNull();
  });
});
