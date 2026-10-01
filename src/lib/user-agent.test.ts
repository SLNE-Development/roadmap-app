import { describe, expect, it } from "vitest";
import { describeUserAgent, parseUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "Chrome on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0", "Edge on Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari on iPhone"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1", "Chrome on iPhone"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0", "Firefox on Linux"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", "Safari on macOS"],
    ["Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1", "Safari on iPad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Claude/0.12.0 Chrome/126.0.0.0 Electron/31.0.0 Safari/537.36", "Claude desktop on macOS"],
    [null, "Unknown device"],
    ["", "Unknown device"],
    ["curl/8.0", "Unknown device"],
  ])("describes %s", (ua, expected) => {
    expect(describeUserAgent(ua)).toBe(expected);
  });
});

describe("parseUserAgent", () => {
  it("returns browser and system", () => {
    expect(parseUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0")).toEqual({ browser: "Firefox", system: "Linux" });
  });

  it("returns a browser without a system", () => {
    expect(parseUserAgent("Mozilla/5.0 (Unknown) Chrome/126.0.0.0 Safari/537.36")).toEqual({ browser: "Chrome", system: null });
  });

  it("returns nulls when missing or not a browser", () => {
    expect(parseUserAgent(null)).toEqual({ browser: null, system: null });
    expect(parseUserAgent("curl/8.0")).toEqual({ browser: null, system: null });
  });
});
