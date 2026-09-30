import { describe, expect, it } from "vitest";
import { dayLabel, formatDate, formatTime, relativeAge } from "./time";

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
    expect(relativeAge("2026-08-01T12:00:00Z", NOW)).toBe("1 Aug");
  });
});

describe("formatDate", () => {
  it("omits the year of the current year", () => {
    expect(formatDate("2026-09-12T08:00:00Z", NOW)).toBe("12 Sep");
  });

  it("adds the year of other years", () => {
    expect(formatDate("2025-12-31T23:00:00Z", NOW)).toBe("31 Dec 2025");
  });
});

describe("formatTime", () => {
  it("pads hours and minutes", () => {
    expect(formatTime("2026-09-27T09:05:00Z")).toBe("09:05");
  });
});

describe("dayLabel", () => {
  it("names today and yesterday, then dates", () => {
    expect(dayLabel("2026-09-27T01:00:00Z", NOW)).toBe("Today");
    expect(dayLabel("2026-09-26T23:00:00Z", NOW)).toBe("Yesterday");
    expect(dayLabel("2026-09-20T10:00:00Z", NOW)).toBe("20 Sep");
  });
});
