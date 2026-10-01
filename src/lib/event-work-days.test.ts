import { describe, expect, it } from "vitest";
import { workingDaysBetween } from "./event-work-days";

const BERLIN = "Europe/Berlin";
/** A Berlin wall-clock time in winter (UTC+1) as an instant. */
const winter = (day: string, hour: number, minute = 0) => new Date(`${day}T${String(hour - 1).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);

describe("workingDaysBetween", () => {
  // 2026-01-09 is a Friday.
  it("counts no full day from Friday evening to Monday morning", () => {
    expect(workingDaysBetween(winter("2026-01-09", 17), winter("2026-01-12", 9), BERLIN)).toBe(0);
  });

  it("counts Thursday 09:00 to Monday 09:00 as two", () => {
    expect(workingDaysBetween(winter("2026-01-08", 9), winter("2026-01-12", 9), BERLIN)).toBe(2);
  });

  it("excludes the weekend from Friday 09:00 to Tuesday 09:00", () => {
    expect(workingDaysBetween(winter("2026-01-09", 9), winter("2026-01-13", 9), BERLIN)).toBe(2);
  });

  it("counts plain weekdays", () => {
    expect(workingDaysBetween(winter("2026-01-12", 9), winter("2026-01-15", 9), BERLIN)).toBe(3);
  });

  it("counts nothing inside a weekend", () => {
    expect(workingDaysBetween(winter("2026-01-10", 9), winter("2026-01-11", 20), BERLIN)).toBe(0);
  });

  it("crosses a month boundary", () => {
    // Fri 2026-01-30 09:00 to Wed 2026-02-04 09:00: Fri, Mon, Tue.
    expect(workingDaysBetween(winter("2026-01-30", 9), winter("2026-02-04", 9), BERLIN)).toBe(3);
  });

  it("is not thrown off by the spring daylight saving change", () => {
    // Fri 2026-03-27 09:00 (UTC+1) to Tue 2026-03-31 09:00 (UTC+2).
    expect(workingDaysBetween(new Date("2026-03-27T08:00:00Z"), new Date("2026-03-31T07:00:00Z"), BERLIN)).toBe(2);
  });

  it("is not thrown off by the autumn daylight saving change", () => {
    // Fri 2026-10-23 09:00 (UTC+2) to Tue 2026-10-27 09:00 (UTC+1).
    expect(workingDaysBetween(new Date("2026-10-23T07:00:00Z"), new Date("2026-10-27T08:00:00Z"), BERLIN)).toBe(2);
  });

  it("uses the zone's weekday, not UTC's", () => {
    // Sun 23:30 UTC is already Monday 00:30 in Berlin.
    expect(workingDaysBetween(new Date("2026-01-11T23:30:00Z"), new Date("2026-01-13T00:30:00Z"), BERLIN)).toBe(1);
  });

  it("is 0 when from is not before to", () => {
    const at = winter("2026-01-12", 9);
    expect(workingDaysBetween(at, at, BERLIN)).toBe(0);
    expect(workingDaysBetween(winter("2026-01-13", 9), at, BERLIN)).toBe(0);
  });
});
