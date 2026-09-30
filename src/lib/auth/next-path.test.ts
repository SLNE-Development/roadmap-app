import { describe, expect, it } from "vitest";
import { safeNextPath } from "./next-path";

describe("safeNextPath", () => {
  it.each([
    ["/p/demo/systems/login?tab=spec", "/p/demo/systems/login?tab=spec"],
    [undefined, "/"],
    [null, "/"],
    ["", "/"],
    ["//evil.test", "/"],
    ["/\\evil.test", "/"],
    ["/\t/evil.test", "/"],
    ["/\n/evil.test", "/"],
    ["https://evil.test", "/"],
    ["/login", "/"],
    ["/login?next=/x", "/"],
    ["/api/auth/sign-out", "/"],
    [["/a", "/b"], "/b"],
    ["/" + "a".repeat(2099), "/"],
  ])("maps %j to %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
