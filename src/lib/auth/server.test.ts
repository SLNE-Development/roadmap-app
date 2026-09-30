import { describe, expect, it, vi } from "vitest";

/** `server.ts` builds Better Auth lazily; importing it needs no environment. */
vi.mock("@/db/client", () => ({ getDb: () => ({}) }));

import { BLOCKED_AUTH_PATH, isBlockedAuthRequest } from "./server";

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
