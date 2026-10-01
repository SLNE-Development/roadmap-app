import { describe, expect, it } from "vitest";
import { timeInCategory } from "./column-time";

const DAY = 86_400_000;
const d = (day: string) => new Date(`2026-09-${day}T00:00:00Z`);

describe("timeInCategory", () => {
  it("adds up the time between moves per category", () => {
    const t = timeInCategory({
      createdAt: d("01"),
      moves: [
        { at: d("03"), to: "active" },
        { at: d("05"), to: "review" },
        { at: d("06"), to: "done" },
      ],
      now: d("10"),
    });
    expect(t).toMatchObject({ planning: 2 * DAY, active: 2 * DAY, review: DAY, done: 4 * DAY, todo: 0, blocked: 0, unknown: 0 });
  });

  it("keeps a system without moves in planning", () => {
    const t = timeInCategory({ createdAt: d("01"), moves: [], now: d("04") });
    expect(t.planning).toBe(3 * DAY);
    expect(t.active).toBe(0);
  });

  it("counts a move to an unresolved column as unknown", () => {
    const t = timeInCategory({ createdAt: d("01"), moves: [{ at: d("02"), to: "unknown" }], now: d("05") });
    expect(t).toMatchObject({ planning: DAY, unknown: 3 * DAY });
  });
});
