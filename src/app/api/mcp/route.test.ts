import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db";
import { oauthClient, oauthConsent } from "@/db/schema";
import { createProjectFixture } from "@/test/fixtures";
import { DELETE, GET, POST } from "./route";

/** Stand-in for Better Auth's `verifyApiKey`, so tests choose the verification result. */
const { verifyApiKey } = vi.hoisted(() => ({ verifyApiKey: vi.fn() }));
vi.mock("@/lib/auth/server", () => ({ getAuth: () => ({ api: { verifyApiKey } }) }));

/**
 * Stand-in for Better Auth's MCP token check: `Bearer jwt-<userId>` verifies as a token of client
 * `cli-1` for that user; anything else gets the challenge the real check sends.
 */
const { mcpAuthOptions } = vi.hoisted(() => ({ mcpAuthOptions: [] as unknown[] }));
vi.mock("@better-auth/mcp", () => ({
  requireMcpAuth: (_auth: unknown, handler: (request: Request, claims: Record<string, unknown>) => Promise<Response>, opts: unknown) => async (request: Request) => {
    mcpAuthOptions.push(opts);
    const token = /^Bearer jwt-(\S+)$/.exec(request.headers.get("authorization") ?? "");
    if (token) return handler(request, { sub: token[1], client_id: "cli-1" });
    return new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="from-better-auth"' } });
  },
}));

/**
 * Stand-ins for auth event recording; the database finds the rate-limited key as `k1`,
 * unless a test sets a real database in `testDb`.
 */
const { recordThrottled, testDb } = vi.hoisted(() => ({ recordThrottled: vi.fn(), testDb: { current: null as unknown } }));
vi.mock("@/lib/ops/audit", () => ({ recordThrottled }));
vi.mock("@/db/client", () => ({
  getDb: () => testDb.current ?? { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "k1", userId: "u1" }] }) }) }) },
}));

/** The route records calls through `after`; here every recording attempt throws. */
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("recorder down");
  },
}));

/** Sends an MCP POST with a bearer key. */
function post(): Promise<Response> {
  return POST(new Request("http://test/api/mcp", { method: "POST", headers: { authorization: "Bearer rmk_test" }, body: "{}" }));
}

/** A failed verification as the API key plugin reports it. */
function failure(code: string, message: string, details?: unknown) {
  return { valid: false, error: { message, code, ...(details === undefined ? {} : { details }) }, key: null };
}

/** A tools/call request for `list_projects` with the given bearer token. */
function listProjects(token: string): Request {
  return new Request("http://test/api/mcp", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } }),
  });
}

describe("MCP route", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_URL", "http://test");
    verifyApiKey.mockReset();
    recordThrottled.mockReset();
    testDb.current = null;
  });

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

  it("records a rejected key throttled by its first 12 characters, never the key itself", async () => {
    verifyApiKey.mockResolvedValueOnce(failure("INVALID_API_KEY", "Invalid API key."));
    await POST(new Request("http://test/api/mcp", { method: "POST", headers: { authorization: "Bearer rmk_abcdefghijklmnop" }, body: "{}" }));
    expect(recordThrottled).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: "key-rejected", detail: "INVALID_API_KEY" }),
      "audit:rej:rmk_abcdefgh",
      60,
    );
    expect(JSON.stringify(recordThrottled.mock.calls[0][2])).not.toContain("rmk_abcdefghijklmnop");
  });

  it("records a rate-limited key throttled by its id", async () => {
    verifyApiKey.mockResolvedValueOnce(failure("RATE_LIMITED", "Rate limit exceeded."));
    await post();
    expect(recordThrottled).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ kind: "key-rate-limited", apiKeyId: "k1", userId: "u1" }),
      "audit:rl:k1",
      60,
    );
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

  it("answers a tool call unchanged when the recorder throws", async () => {
    const db = await createTestDb();
    const { owner, slug } = await createProjectFixture(db);
    testDb.current = db;
    verifyApiKey.mockResolvedValueOnce({ valid: true, error: null, key: { id: "k1", referenceId: owner.userId } });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(
      new Request("http://test/api/mcp", {
        method: "POST",
        headers: { authorization: "Bearer rmk_test", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_projects", arguments: {} } }),
      }),
    );
    expect(response.status).toBe(200);
    const { result } = await response.json();
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text).map((p: { slug: string }) => p.slug)).toEqual([slug]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  describe("with an OAuth access token", () => {
    it("challenges a request without a bearer with Better Auth's WWW-Authenticate header", async () => {
      const response = await POST(new Request("http://test/api/mcp", { method: "POST", body: "{}" }));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
      expect(verifyApiKey).not.toHaveBeenCalled();
    });

    it("verifies tokens for the MCP resource with keys read from this server over loopback", async () => {
      await POST(new Request("http://test/api/mcp", { method: "POST", body: "{}" }));
      expect(mcpAuthOptions.at(-1)).toEqual({ resource: "http://test/api/mcp", jwksUrl: "http://127.0.0.1:3000/api/auth/jwks" });
    });

    it("serves tools as the token's user while their consent stands", async () => {
      const db = await createTestDb();
      const { owner, slug } = await createProjectFixture(db);
      testDb.current = db;
      await db.insert(oauthClient).values({ id: "c1", clientId: "cli-1", redirectUris: ["http://127.0.0.1/cb"], createdAt: new Date(), updatedAt: new Date() });
      await db.insert(oauthConsent).values({ id: "k1", clientId: "cli-1", userId: owner.userId, scopes: [], createdAt: new Date(), updatedAt: new Date() });
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const response = await POST(listProjects(`jwt-${owner.userId}`));
      error.mockRestore();
      expect(response.status).toBe(200);
      const { result } = await response.json();
      expect(JSON.parse(result.content[0].text).map((p: { slug: string }) => p.slug)).toEqual([slug]);
    });

    it("challenges a valid token whose consent was revoked", async () => {
      const db = await createTestDb();
      const { owner } = await createProjectFixture(db);
      testDb.current = db;
      const response = await POST(listProjects(`jwt-${owner.userId}`));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe(
        'Bearer error="invalid_token", error_description="Access was revoked", resource_metadata="http://test/.well-known/oauth-protected-resource/api/mcp"',
      );
    });
  });
});
