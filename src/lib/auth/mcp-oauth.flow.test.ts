import { createHash, randomBytes } from "node:crypto";
import { serializeSignedCookie } from "better-call";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { agentRun, authEvent } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/ops/actor";
import { revokeConnectedApp } from "@/lib/ops/oauth-apps";
import { createTestDb } from "@/test/db";
import { createProjectFixture } from "@/test/fixtures";

/** The database Better Auth and the route run on. */
const { testDb, pending } = vi.hoisted(() => ({ testDb: { current: null as unknown }, pending: [] as Promise<unknown>[] }));
vi.mock("@/db/client", () => ({ getDb: () => testDb.current }));
/** Runs the route's after-response work at once and keeps its promise, so recording can be awaited. */
vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => void pending.push(fn()) }));

const BASE = "https://roadmap.test";
const REDIRECT = "http://127.0.0.1:5555/callback";

/** Asserts `response.status`, showing the body when it differs. */
async function expectStatus(response: Response, status: number): Promise<void> {
  expect({ status: response.status, body: response.status === status ? "" : await response.clone().text() }).toEqual({ status, body: "" });
}

/** Base64url of `bytes`. */
const b64url = (bytes: Buffer) => bytes.toString("base64url");

/**
 * The whole sign-in an MCP client performs: register, authorize with PKCE, consent, exchange the
 * code, then call the MCP endpoint, verified against the server's own JWKS.
 */
describe("MCP OAuth sign-in end to end", () => {
  let db: Db;
  let owner: Actor;
  let slug: string;
  let auth: { handler: (request: Request) => Promise<Response>; $context: Promise<{ secret: string; authCookies: { sessionToken: { name: string } }; internalAdapter: { createSession: (userId: string) => Promise<{ token: string }> } }> };
  let POST: (request: Request) => Promise<Response>;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_URL", BASE);
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("DISCORD_CLIENT_ID", "id");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    db = await createTestDb();
    testDb.current = db;
    ({ owner, slug } = await createProjectFixture(db));
    auth = (await import("./server")).getAuth() as unknown as typeof auth;
    ({ POST } = await import("@/app/api/mcp/route"));
    // The resource server fetches the JWKS from the app's own URL; serve it from the handler.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return request.url.startsWith(BASE) ? auth.handler(request) : realFetch(input, init);
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  /** A session cookie for the owner, as the browser holds it after the Discord sign-in. */
  async function sessionCookie(): Promise<string> {
    const ctx = await auth.$context;
    const session = await ctx.internalAdapter.createSession(owner.userId);
    return (await serializeSignedCookie(ctx.authCookies.sessionToken.name, session.token, ctx.secret)).split(";")[0];
  }

  /** An MCP JSON-RPC call with the bearer `token`. */
  function mcp(token: string, method: string, params: object = {}): Promise<Response> {
    return POST(
      new Request(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
  }

  it("connects, serves tools as the user, records the run, and stops at once when revoked", async () => {
    const register = await auth.handler(
      new Request(`${BASE}/api/auth/oauth2/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" }),
      }),
    );
    await expectStatus(register, 201);
    const { client_id: clientId } = await register.json();

    const cookie = await sessionCookie();
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const authorize = new URL(`${BASE}/api/auth/oauth2/authorize`);
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "st-1",
      resource: `${BASE}/api/mcp`,
    }))
      authorize.searchParams.set(k, v);
    const toConsent = await auth.handler(new Request(authorize, { headers: { cookie } }));
    const consentUrl = new URL(toConsent.headers.get("location") ?? "", BASE);
    expect(consentUrl.pathname).toBe("/oauth/consent");

    const consent = await auth.handler(
      new Request(`${BASE}/api/auth/oauth2/consent`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) }),
      }),
    );
    await expectStatus(consent, 200);
    const back = new URL((await consent.json()).url);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("st-1");

    const token = await auth.handler(
      new Request(`${BASE}/api/auth/oauth2/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: back.searchParams.get("code") ?? "",
          redirect_uri: REDIRECT,
          client_id: clientId,
          code_verifier: verifier,
          resource: `${BASE}/api/mcp`,
        }),
      }),
    );
    await expectStatus(token, 200);
    const { access_token: accessToken } = await token.json();

    const init = await mcp(accessToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    const listed = await mcp(accessToken, "tools/call", { name: "list_projects", arguments: {} });
    expect(listed.status).toBe(200);
    const { result } = await listed.json();
    expect(JSON.parse(result.content[0].text).map((p: { slug: string }) => p.slug)).toEqual([slug]);
    await Promise.all(pending);
    const runs = await db.select({ key: agentRun.apiKeyId }).from(agentRun).where(eq(agentRun.userId, owner.userId));
    expect(runs).toEqual([{ key: `oauth:${owner.userId}:${clientId}` }]);
    const events = await db.select({ kind: authEvent.kind, client: authEvent.apiKeyId }).from(authEvent).where(eq(authEvent.kind, "oauth-consented"));
    expect(events).toEqual([{ kind: "oauth-consented", client: clientId }]);

    await revokeConnectedApp(db, owner, clientId);
    const revoked = await mcp(accessToken, "tools/call", { name: "list_projects", arguments: {} });
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("challenges a forged token with the protected resource metadata", async () => {
    const response = await mcp("eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.", "tools/list");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
  });
});
