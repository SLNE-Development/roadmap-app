import { describe, expect, it, vi } from "vitest";

/** `server.ts` builds Better Auth lazily; importing it needs no environment. */
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));

import { BLOCKED_AUTH_PATH, isBlockedAuthRequest, withNativeDefault } from "./server";

describe("isBlockedAuthRequest", () => {
  it("blocks the api-key endpoints for HTTP requests", () => {
    expect(isBlockedAuthRequest("/api-key/create", true)).toBe(true);
    expect(isBlockedAuthRequest("/api-key/list", true)).toBe(true);
  });

  it("lets server-side calls without a request through", () => {
    expect(isBlockedAuthRequest("/api-key/create", false)).toBe(false);
  });

  it("leaves other auth endpoints alone", () => {
    expect(isBlockedAuthRequest("/sign-in/social", true)).toBe(false);
    expect(BLOCKED_AUTH_PATH.test("/api-key/verify")).toBe(true);
  });
});

describe("withNativeDefault", () => {
  it("marks a registration with only loopback redirects as a native app", () => {
    for (const uri of ["http://localhost:5555/callback", "http://127.0.0.1:1/cb", "http://[::1]:8080/cb"]) {
      expect(withNativeDefault({ redirect_uris: [uri] })).toEqual({ redirect_uris: [uri], application_type: "native" });
    }
  });

  it("leaves web redirects, mixed redirects and an explicit application type alone", () => {
    const web = { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] };
    const mixed = { redirect_uris: ["http://localhost:1/cb", "https://example.com/cb"] };
    const explicit = { redirect_uris: ["http://localhost:1/cb"], application_type: "web" };
    expect(withNativeDefault(web)).toBe(web);
    expect(withNativeDefault(mixed)).toBe(mixed);
    expect(withNativeDefault(explicit)).toBe(explicit);
    expect(withNativeDefault({ redirect_uris: ["http://localhost.evil.com/cb"] })).toEqual({ redirect_uris: ["http://localhost.evil.com/cb"] });
  });
});
