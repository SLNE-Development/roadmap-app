import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

describe("proxy", () => {
  it("redirects to /login and remembers the requested page", () => {
    const response = proxy(new NextRequest("http://test/p/demo/adrs/3?x=1"));
    expect(response.headers.get("location")).toBe("http://test/login?next=%2Fp%2Fdemo%2Fadrs%2F3%3Fx%3D1");
  });

  it("sends the root to /login without a next", () => {
    const response = proxy(new NextRequest("http://test/"));
    expect(response.headers.get("location")).toBe("http://test/login");
  });
});
