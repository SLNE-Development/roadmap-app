import { describe, expect, it } from "vitest";
import { fromZonedInput, toZonedInput } from "./zoned-time";

describe("zoned time", () => {
  it("reads and writes the clock of a time zone", () => {
    const date = fromZonedInput("2026-07-01T20:00", "Europe/Berlin");
    expect(date?.toISOString()).toBe("2026-07-01T18:00:00.000Z");
    expect(toZonedInput(date!, "Europe/Berlin")).toBe("2026-07-01T20:00");
    expect(fromZonedInput("2026-01-15T20:00", "Europe/Berlin")?.toISOString()).toBe("2026-01-15T19:00:00.000Z");
    expect(fromZonedInput("2026-01-15T20:00", "UTC")?.toISOString()).toBe("2026-01-15T20:00:00.000Z");
  });

  it("rejects an empty or malformed value", () => {
    expect(fromZonedInput("", "UTC")).toBeNull();
    expect(fromZonedInput("tomorrow", "UTC")).toBeNull();
  });
});
