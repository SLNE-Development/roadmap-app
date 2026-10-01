import { describe, expect, it } from "vitest";
import { discordTimestamp, renderTimestamps } from "./discord-timestamp";

describe("discordTimestamp", () => {
  it("writes the Unix seconds and the style", () => {
    expect(discordTimestamp(new Date("2026-10-03T18:00:00Z"), "F")).toBe("<t:1791050400:F>");
  });
});

describe("renderTimestamps", () => {
  it("renders the short time in the zone", () => {
    expect(renderTimestamps("Start <t:1791050400:t>", "de-DE", "Europe/Berlin")).toBe("Start 20:00");
  });

  it("renders the date styles", () => {
    expect(renderTimestamps("<t:1791050400:D>", "de-DE", "Europe/Berlin")).toBe("3. Oktober 2026");
    expect(renderTimestamps("<t:1791050400:d>", "de-DE", "Europe/Berlin")).toBe("03.10.2026");
    expect(renderTimestamps("<t:1791050400:F>", "de-DE", "Europe/Berlin")).toContain("Samstag");
    expect(renderTimestamps("<t:1791050400>", "de-DE", "Europe/Berlin")).toContain("20:00");
    expect(renderTimestamps("<t:1791050400:T>", "de-DE", "Europe/Berlin")).toBe("20:00:00");
  });

  it("renders the relative style against now", () => {
    const now = new Date("2026-09-30T18:00:00Z");
    expect(renderTimestamps("<t:1791050400:R>", "de-DE", "Europe/Berlin", now)).toBe("in 3 Tagen");
  });

  it("leaves malformed tokens as written", () => {
    expect(renderTimestamps("<t:abc:F>", "de-DE", "Europe/Berlin")).toBe("<t:abc:F>");
  });
});
