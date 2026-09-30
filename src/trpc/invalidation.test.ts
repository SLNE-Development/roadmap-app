import { describe, expect, it } from "vitest";
import { affectedRouters, queryRouter } from "./invalidation";

describe("affectedRouters", () => {
  it("scopes a task mutation to the routers that show tasks", () => {
    const routers = affectedRouters([["tasks", "update"]]);
    expect(routers).toContain("systems");
    expect(routers).not.toContain("members");
  });

  it("invalidates everything without a mutation key", () => {
    expect(affectedRouters(undefined)).toBe("all");
  });

  it("invalidates everything for an unknown router", () => {
    expect(affectedRouters([["unknown", "x"]])).toBe("all");
  });
});

describe("queryRouter", () => {
  it("reads the router of a query key", () => {
    expect(queryRouter([["planning", "gaps"], { input: { project: "p" }, type: "query" }])).toBe("planning");
  });
});
