import { describe, expect, it } from "vitest";
import { DELETE, GET } from "./route";

describe("MCP route", () => {
  it("answers GET with 405 and an Allow header", async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.json()).toMatchObject({ jsonrpc: "2.0", error: { code: -32000 } });
  });

  it("requires an API key for DELETE", async () => {
    expect((await DELETE(new Request("http://test/api/mcp", { method: "DELETE" }))).status).toBe(401);
  });
});
