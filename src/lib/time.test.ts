import { describe, expect, it } from "vitest";
import { relativeAge } from "./time";

const NOW = new Date("2026-09-27T12:00:00Z");

describe("relativeAge", () => {
  it("says just now under a minute", () => {
    expect(relativeAge("2026-09-27T11:59:30Z", NOW)).toBe("just now");
  });

  it("uses minutes, hours and days", () => {
    expect(relativeAge("2026-09-27T11:55:00Z", NOW)).toBe("5 min ago");
    expect(relativeAge("2026-09-27T09:00:00Z", NOW)).toBe("3 h ago");
    expect(relativeAge("2026-09-24T12:00:00Z", NOW)).toBe("3 d ago");
  });

  it("falls back to the date after 30 days", () => {
    expect(relativeAge("2026-08-01T12:00:00Z", NOW)).toBe("2026-08-01");
  });
});
