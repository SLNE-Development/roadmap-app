import { describe, expect, it } from "vitest";
import { hasFilters, parseBoardQuery, withParam } from "./url-filters";

describe("parseBoardQuery", () => {
  it("reads the filters and trims q", () => {
    expect(parseBoardQuery({ q: "  search ", priority: "MVP", owner: "none" })).toEqual({
      q: "search",
      domain: null,
      phase: null,
      priority: "MVP",
      owner: "none",
      lane: "none",
    });
  });

  it("drops invalid priority and lane", () => {
    const query = parseBoardQuery({ priority: "urgent", lane: "colour" });
    expect(query.priority).toBeNull();
    expect(query.lane).toBe("none");
  });

  it("uses the first element of an array", () => {
    expect(parseBoardQuery({ domain: ["a", "b"] }).domain).toBe("a");
  });

  it("caps q at 100 characters", () => {
    expect(parseBoardQuery({ q: "x".repeat(300) }).q).toHaveLength(100);
  });
});

describe("withParam", () => {
  it("removes a key and keeps the others", () => {
    expect(withParam("?q=x&domain=d", "domain", null)).toBe("?q=x");
  });

  it("adds a key to an empty query", () => {
    expect(withParam("", "phase", "p1")).toBe("?phase=p1");
  });

  it("removes a key set to the empty string", () => {
    expect(withParam("?q=x", "q", "")).toBe("");
  });

  it("encodes values and keeps key order when replacing", () => {
    expect(withParam("?q=x&phase=p", "q", "a b")).toBe("?q=a+b&phase=p");
  });
});

describe("hasFilters", () => {
  it("ignores the lane", () => {
    expect(hasFilters(parseBoardQuery({ lane: "domain" }))).toBe(false);
  });

  it("is true when a filter is set", () => {
    expect(hasFilters(parseBoardQuery({ q: "a" }))).toBe(true);
  });
});
