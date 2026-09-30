import { describe, expect, it } from "vitest";
import { appRouter } from "@/server/trpc/router";
import { affectedRouters, INVALIDATES, queryRouter, shouldInvalidate } from "./invalidation";

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

describe("INVALIDATES", () => {
  it("has an entry for every registered router", () => {
    for (const name of Object.keys(appRouter._def.record)) expect(Object.hasOwn(INVALIDATES, name), name).toBe(true);
  });

  it("scopes a board mutation to the planning gaps too", () => {
    expect(affectedRouters([["boards", "update"]])).toContain("planning");
  });
});

describe("shouldInvalidate", () => {
  it("refetches project-less queries after an ordinary mutation", () => {
    expect(shouldInvalidate([["account", "apiKeys"], { type: "query" }], [["account", "createApiKey"]], undefined)).toBe(true);
  });

  it("refetches project-less queries for the all fallback", () => {
    expect(shouldInvalidate([["projects", "list"], { type: "query" }], [["unknown", "x"]], undefined)).toBe(true);
  });

  it("skips queries of routers the mutation does not affect", () => {
    expect(shouldInvalidate([["members", "list"], { input: { project: "p" }, type: "query" }], [["tasks", "update"]], undefined)).toBe(false);
  });

  it("skips queries of a project that was left", () => {
    expect(shouldInvalidate([["systems", "get"], { input: { project: "gone" }, type: "query" }], [["projects", "delete"]], "gone")).toBe(false);
  });

  it("still refetches project-less queries when a project was left", () => {
    expect(shouldInvalidate([["projects", "list"], { type: "query" }], [["projects", "delete"]], "gone")).toBe(true);
  });
});

describe("queryRouter", () => {
  it("reads the router of a query key", () => {
    expect(queryRouter([["planning", "gaps"], { input: { project: "p" }, type: "query" }])).toBe("planning");
  });
});
