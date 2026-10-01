import { describe, expect, it } from "vitest";
import { dueFor, PREP_TEMPLATE, REQUIRED_FALLBACKS } from "./event-prep-template";

const BERLIN = "Europe/Berlin";

describe("dueFor", () => {
  it("is 09:00 local on the offset day", () => {
    expect(dueFor(new Date("2026-10-17T18:00:00Z"), -8, BERLIN).toISOString()).toBe("2026-10-09T07:00:00.000Z");
  });

  it("keeps 09:00 local across the end of daylight saving time", () => {
    const start = new Date("2026-10-26T18:00:00Z");
    expect(dueFor(start, -2, BERLIN).toISOString()).toBe("2026-10-24T07:00:00.000Z");
    expect(dueFor(start, -1, BERLIN).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });

  it("uses the local date, not the UTC date", () => {
    // 23:30 UTC is already the next day in Berlin
    expect(dueFor(new Date("2026-10-17T23:30:00Z"), 0, BERLIN).toISOString()).toBe("2026-10-18T07:00:00.000Z");
  });
});

describe("templates", () => {
  it("has the six prep offsets", () => {
    expect(PREP_TEMPLATE.map((s) => s.offsetDays)).toEqual([-8, -7, -3, -2, -1, 1]);
  });

  it("has the one required fallback", () => {
    expect(REQUIRED_FALLBACKS.map((f) => f.key)).toEqual(["server-down"]);
  });
});
