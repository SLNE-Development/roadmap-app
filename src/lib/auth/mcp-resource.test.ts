import { afterEach, describe, expect, it, vi } from "vitest";
import { internalJwksUrl, mcpResource } from "./mcp-resource";

describe("mcpResource", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the MCP endpoint under the public base URL", () => {
    vi.stubEnv("BETTER_AUTH_URL", "https://roadmap.example.com/");
    expect(mcpResource()).toBe("https://roadmap.example.com/api/mcp");
  });

  it("names the variable when the base URL is missing", () => {
    vi.stubEnv("BETTER_AUTH_URL", "");
    expect(() => mcpResource()).toThrow("BETTER_AUTH_URL");
  });
});

describe("internalJwksUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the signing keys from this server over loopback, on its port", () => {
    vi.stubEnv("PORT", "4100");
    expect(internalJwksUrl()).toBe("http://127.0.0.1:4100/api/auth/jwks");
  });

  it("defaults to port 3000", () => {
    vi.stubEnv("PORT", "");
    expect(internalJwksUrl()).toBe("http://127.0.0.1:3000/api/auth/jwks");
  });
});
