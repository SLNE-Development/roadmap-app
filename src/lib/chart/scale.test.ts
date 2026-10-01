import { describe, expect, it } from "vitest";
import { addDays, dayKeys, dayTicks, linearScale, niceTicks } from "./scale";

describe("linearScale", () => {
  it("maps the domain onto the range and back", () => {
    const s = linearScale([0, 200], [180, 10]);
    expect(s(0)).toBe(180);
    expect(s(200)).toBe(10);
    expect(s(100)).toBe(95);
    expect(s.invert(95)).toBe(100);
  });

  it("maps a degenerate domain to the range start", () => {
    const s = linearScale([5, 5], [0, 100]);
    expect(s(5)).toBe(0);
    expect(Number.isNaN(s(9))).toBe(false);
  });
});

describe("niceTicks", () => {
  it("uses steps of 1, 2 or 5 times a power of ten", () => {
    expect(niceTicks(164)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(1000)).toEqual([0, 500, 1000]);
  });
});

describe("day helpers", () => {
  it("lists every UTC day key inclusive", () => {
    expect(
      dayKeys(new Date("2026-09-29T23:30:00Z"), new Date("2026-10-01T00:10:00Z")),
    ).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
  });

  it("picks at most five ticks including first and last", () => {
    const keys = Array.from({ length: 42 }, (_, i) => addDays("2026-09-02", i));
    const ticks = dayTicks(keys);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(ticks[0]).toEqual({ index: 0, label: "2 Sep" });
    expect(ticks[ticks.length - 1].index).toBe(41);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].index).toBeGreaterThan(ticks[i - 1].index);
    }
  });
});
