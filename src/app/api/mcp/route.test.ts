import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./route";

/** Stand-in for Better Auth's `verifyApiKey`, so tests choose the verification result. */
const { verifyApiKey } = vi.hoisted(() => ({ verifyApiKey: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: { verifyApiKey } }) }));

/** Sends an MCP POST with a bearer key. */
function post(): Promise<Response> {
  return POST(new Request("http://test/api/mcp", { method: "POST", headers: { authorization: "Bearer rmk_test" }, body: "{}" }));
}

/** A failed verification as the API key plugin reports it. */
function failure(code: string, message: string, details?: unknown) {
  return { valid: false, error: { message, code, ...(details === undefined ? {} : { details }) }, key: null };
}

describe("MCP route", () => {
  beforeEach(() => verifyApiKey.mockReset());

  it("answers GET with 405 and an Allow header", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
  });

  it("requires an API key for DELETE", async () => {
    expect((await DELETE(new Request("http://test/api/mcp", { method: "DELETE" }))).status).toBe(401);
  });

  it("answers invalid, expired and disabled keys with 401", async () => {
    for (const [code, message] of [
      ["INVALID_API_KEY", "Invalid API key."],
      ["KEY_EXPIRED", "API Key has expired"],
      ["KEY_DISABLED", "API Key is disabled"],
      ["USAGE_EXCEEDED", "API Key has reached its usage limit"],
    ]) {
      verifyApiKey.mockResolvedValueOnce(failure(code, message));
      const response = await post();
      expect(response.status).toBe(401);
      expect((await response.json()).error).toContain("Missing or invalid API key");
    }
  });

  it("answers a rate-limited key with 429 and Retry-After in whole seconds", async () => {
    verifyApiKey.mockResolvedValueOnce(failure("RATE_LIMITED", "Rate limit exceeded.", { tryAgainIn: 41_234 }));
    const response = await post();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.json()).toEqual({ error: "API key rate limit exceeded: at most 600 requests per minute. Retry in 42 s." });
  });

  it("answers a failing key check with a JSON 500", async () => {
    verifyApiKey.mockRejectedValueOnce(new Error("db down"));
    const response = await post();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Something went wrong." });
  });

  it("omits Retry-After when the plugin gives no retry time", async () => {
    verifyApiKey.mockResolvedValueOnce(failure("RATE_LIMITED", "Rate limit exceeded."));
    const response = await post();
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBeNull();
    expect((await response.json()).error).toBe("API key rate limit exceeded: at most 600 requests per minute. Retry shortly.");
  });
});
