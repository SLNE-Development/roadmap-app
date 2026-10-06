import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

/** Whether the proxy's matcher covers `path`; the matcher is a plain regular expression source. */
function guarded(path: string): boolean {
  return new RegExp(`^${config.matcher[0]}$`).test(path);
}

describe("proxy", () => {
  it("leaves OAuth discovery to its route handlers", () => {
    expect(guarded("/.well-known/oauth-authorization-server/api/auth")).toBe(false);
    expect(guarded("/.well-known/oauth-protected-resource/api/mcp")).toBe(false);
    expect(guarded("/p/demo")).toBe(true);
  });

  it("redirects to /login and remembers the requested page", () => {
    const response = proxy(new NextRequest("http://test/p/demo/adrs/3?x=1"));
    expect(response.headers.get("location")).toBe("http://test/login?next=%2Fp%2Fdemo%2Fadrs%2F3%3Fx%3D1");
  });

  it("sends the root to /login without a next", () => {
    const response = proxy(new NextRequest("http://test/"));
    expect(response.headers.get("location")).toBe("http://test/login");
  });
});
