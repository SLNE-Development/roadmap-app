import { describe, expect, it } from "vitest";
import { daysUntil } from "./time";

const NOW = new Date("2026-09-27T12:00:00Z");

describe("daysUntil", () => {
  it("counts UTC days, ignoring the time of day", () => {
    expect(daysUntil("2026-10-21", NOW)).toBe(24);
    expect(daysUntil("2026-09-27", NOW)).toBe(0);
    expect(daysUntil("2026-09-25", NOW)).toBe(-2);
  });
});
