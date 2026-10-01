import { describe, expect, it } from "vitest";
import { projectHealth, type HealthInput } from "./health";

const DAY = 86_400_000;
const now = new Date("2026-10-01T12:00:00Z");
const ago = (days: number) => new Date(now.getTime() - days * DAY);

/** A healthy project with ten open systems, tweaked per test. */
function input(over: Partial<HealthInput> = {}): HealthInput {
  return { systems: 12, notDone: 10, blocked: 0, activeOrReview: 4, staleSystems: 0, blockingQuestions: 0, lastChange: ago(1), now, ...over };
}

describe("projectHealth", () => {
  it("is empty without systems and gives no reasons", () => {
    expect(projectHealth(input({ systems: 0, notDone: 0, lastChange: null }))).toEqual({ status: "empty", reasons: [] });
  });

  it("is on track when everything is done, even if quiet", () => {
    expect(projectHealth(input({ notDone: 0, lastChange: ago(90) }))).toEqual({ status: "on-track", reasons: [{ code: "allDone" }] });
  });

  it("is on track without any signal", () => {
    expect(projectHealth(input())).toEqual({ status: "on-track", reasons: [] });
  });

  it("is stalled when there is no change at all", () => {
    const h = projectHealth(input({ lastChange: null }));
    expect(h.status).toBe("stalled");
    expect(h.reasons).toEqual([{ code: "noChanges", days: null, limit: 14 }]);
  });

  it("is stalled when the last change is exactly 14 days old, not at 13.9", () => {
    const h = projectHealth(input({ lastChange: ago(14) }));
    expect(h).toEqual({ status: "stalled", reasons: [{ code: "noChanges", days: 14, limit: 14 }] });
    expect(projectHealth(input({ lastChange: ago(13.9) })).status).toBe("on-track");
  });

  it("is stalled when half of the systems in progress have gone quiet", () => {
    const h = projectHealth(input({ activeOrReview: 4, staleSystems: 2 }));
    expect(h).toEqual({ status: "stalled", reasons: [{ code: "quietProgress", stale: 2, total: 4 }] });
    expect(projectHealth(input({ activeOrReview: 4, staleSystems: 1 })).status).toBe("at-risk");
  });

  it("lists both stalled reasons at once", () => {
    const h = projectHealth(input({ lastChange: ago(20), activeOrReview: 2, staleSystems: 2 }));
    expect(h.status).toBe("stalled");
    expect(h.reasons).toEqual([{ code: "noChanges", days: 20, limit: 14 }, { code: "quietProgress", stale: 2, total: 2 }]);
  });

  it("is at risk when a fifth of the open systems are blocked, not at 0.19", () => {
    expect(projectHealth(input({ blocked: 2 }))).toEqual({ status: "at-risk", reasons: [{ code: "blocked", blocked: 2, open: 10 }] });
    expect(projectHealth(input({ notDone: 100, blocked: 19 })).status).toBe("on-track");
  });

  it("is at risk with one stale system or a blocking question", () => {
    expect(projectHealth(input({ staleSystems: 1 })).reasons).toEqual([{ code: "staleSystems", count: 1, days: 7 }]);
    expect(projectHealth(input({ blockingQuestions: 3 })).reasons).toEqual([{ code: "blockingQuestions", count: 3 }]);
    expect(projectHealth(input({ blockingQuestions: 1 })).reasons).toEqual([{ code: "blockingQuestions", count: 1 }]);
    expect(projectHealth(input({ staleSystems: 2, activeOrReview: 10 })).reasons).toEqual([{ code: "staleSystems", count: 2, days: 7 }]);
  });

  it("lists every at-risk reason", () => {
    const h = projectHealth(input({ blocked: 3, staleSystems: 1, blockingQuestions: 1 }));
    expect(h.status).toBe("at-risk");
    expect(h.reasons).toHaveLength(3);
  });
});
