import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/test/db";
import { GET } from "./route";

/** The database Better Auth runs on; set before the first request creates the auth instance. */
const { testDb } = vi.hoisted(() => ({ testDb: { current: null as unknown } }));
vi.mock("@/db/client", () => ({ getDb: () => testDb.current }));

const BASE = "https://roadmap.test";

describe("OAuth discovery", () => {
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_URL", BASE);
    vi.stubEnv("BETTER_AUTH_SECRET", "s".repeat(32));
    vi.stubEnv("DISCORD_CLIENT_ID", "id");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "secret");
    testDb.current = await createTestDb();
  });

  it("names the MCP endpoint and its authorization server", async () => {
    const response = await GET(new Request(`${BASE}/.well-known/oauth-protected-resource/api/mcp`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: `${BASE}/api/mcp`, authorization_servers: [`${BASE}/api/auth`] });
  });

  it("serves the authorization server metadata with PKCE and registration", async () => {
    const response = await GET(new Request(`${BASE}/.well-known/oauth-authorization-server/api/auth`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ issuer: `${BASE}/api/auth`, code_challenge_methods_supported: ["S256"] });
    expect(body.registration_endpoint).toBe(`${BASE}/api/auth/oauth2/register`);
  });
});
