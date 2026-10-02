import { describe, expect, it } from "vitest";
import { buildManifest, defaultAppName, manifestActionUrl, REQUIRED_EVENTS, REQUIRED_PERMISSIONS } from "./manifest";

const BASE = new URL("https://roadmap.example.com");

describe("buildManifest", () => {
  it("points every URL at the instance", () => {
    const m = buildManifest(BASE, "Roadmap");
    expect(m.url).toBe("https://roadmap.example.com");
    expect(m.hook_attributes).toEqual({ url: "https://roadmap.example.com/api/github/app", active: true });
    expect(m.redirect_url).toBe("https://roadmap.example.com/api/github/manifest/callback");
    expect(m.callback_urls).toEqual(["https://roadmap.example.com/api/github/oauth/callback"]);
    expect(m.setup_url).toBe("https://roadmap.example.com/api/github/setup");
    expect(m.setup_on_update).toBe(true);
  });

  it("asks for a public app with the required permissions and events", () => {
    const m = buildManifest(BASE, "Roadmap");
    expect(m.public).toBe(true);
    expect(m.request_oauth_on_install).toBe(false);
    expect(m.default_permissions).toEqual({ metadata: "read", contents: "read", pull_requests: "write", checks: "read" });
    expect(m.default_permissions).toEqual(REQUIRED_PERMISSIONS);
    expect(m.default_events).toEqual(["pull_request", "push", "check_suite", "issue_comment"]);
    expect(m.default_events).toEqual(REQUIRED_EVENTS);
    expect(m.default_events).not.toContain("installation");
  });

  it("cuts the name to 34 characters", () => {
    expect(buildManifest(BASE, "x".repeat(50)).name).toHaveLength(34);
  });

  it("falls back to the default name", () => {
    expect(buildManifest(BASE, "  ").name).toBe("Roadmap (roadmap.example.com)");
    expect(defaultAppName(BASE)).toBe("Roadmap (roadmap.example.com)");
  });
});

describe("manifestActionUrl", () => {
  it("creates under the user without an org", () => {
    expect(manifestActionUrl(null, "s")).toBe("https://github.com/settings/apps/new?state=s");
  });

  it("creates under an org", () => {
    expect(manifestActionUrl("SLNE-Development", "s")).toBe("https://github.com/organizations/SLNE-Development/settings/apps/new?state=s");
  });

  it("rejects an invalid org", () => {
    expect(() => manifestActionUrl("bad/org", "s")).toThrow(expect.objectContaining({ name: "InvalidError" }));
  });
});
