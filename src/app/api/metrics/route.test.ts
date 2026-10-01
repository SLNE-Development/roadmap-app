import { describe, expect, it } from "vitest";
import { handleMetrics } from "./route";

const render = async () => "roadmap_db_up 1\n";

/** A GET request to the metrics endpoint with an optional Authorization header. */
function request(authorization?: string): Request {
  return new Request("http://test/api/metrics", { headers: authorization ? { authorization } : {} });
}

describe("handleMetrics", () => {
  it("answers 404 when no token is configured", async () => {
    const response = await handleMetrics(request("Bearer x"), {}, render);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("answers 401 without an Authorization header", async () => {
    const response = await handleMetrics(request(), { METRICS_TOKEN: "secret" }, render);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Missing or invalid metrics token." });
  });

  it("answers 401 for a wrong token", async () => {
    expect((await handleMetrics(request("Bearer wrong"), { METRICS_TOKEN: "secret" }, render)).status).toBe(401);
  });

  it("answers 200 with the rendered text for the right token", async () => {
    const response = await handleMetrics(request("Bearer secret"), { METRICS_TOKEN: "secret" }, render);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; version=0.0.4");
    expect(await response.text()).toBe("roadmap_db_up 1\n");
  });
});
