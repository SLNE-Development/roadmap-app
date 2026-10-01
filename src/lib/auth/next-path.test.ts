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
    ["/api/github/setup?installation_id=5&setup_action=install", "/api/github/setup?installation_id=5&setup_action=install"],
    ["/api/github/manifest/callback?code=c&state=s", "/api/github/manifest/callback?code=c&state=s"],
    ["/api/github/setup", "/api/github/setup"],
    ["/api/github/setupx", "/"],
    ["/api/github/app", "/"],
    ["//api/github/setup", "/"],
    [["/a", "/b"], "/b"],
    ["/" + "a".repeat(2099), "/"],
  ])("maps %j to %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
