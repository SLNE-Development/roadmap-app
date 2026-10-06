import { describe, expect, it } from "vitest";
import config from "../next.config";

describe("next.config headers", () => {
  it("forbids framing the OAuth consent page, so Allow cannot be clickjacked", async () => {
    const rules = (await config.headers?.()) ?? [];
    const oauth = rules.find((r) => r.source === "/oauth/:path*");
    expect(oauth?.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
  });
});
