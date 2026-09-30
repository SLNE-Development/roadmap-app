import { describe, expect, it } from "vitest";
import { queryProject, shouldRetryQuery } from "./query-client";

describe("shouldRetryQuery", () => {
  it.each([400, 401, 403, 404, 409, 429])("does not retry a %i", (httpStatus) => {
    expect(shouldRetryQuery(0, { data: { httpStatus } })).toBe(false);
  });

  it("retries a server error up to three times", () => {
    expect(shouldRetryQuery(0, { data: { httpStatus: 500 } })).toBe(true);
    expect(shouldRetryQuery(3, { data: { httpStatus: 500 } })).toBe(false);
  });

  it("retries an error without a status", () => {
    expect(shouldRetryQuery(0, new Error("network"))).toBe(true);
  });
});

describe("queryProject", () => {
  it("reads the project slug from a tRPC query key", () => {
    expect(queryProject([["projects", "get"], { input: { project: "demo" }, type: "query" }])).toBe("demo");
    expect(queryProject([["systems", "get"], { input: { project: "demo", system: "login" }, type: "query" }])).toBe("demo");
  });

  it("returns undefined for a query without a project", () => {
    expect(queryProject([["projects", "list"], { type: "query" }])).toBeUndefined();
  });
});
