import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpResource } from "./mcp-resource";

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
