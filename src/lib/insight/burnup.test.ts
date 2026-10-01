import { describe, expect, it } from "vitest";
import { addDays, dayKeys } from "@/lib/chart/scale";
import type { TaskState } from "@/db/schema/content";
import {
  projectFinish,
  replayTasks,
  sampleBurnup,
  type BurnupPoint,
  type CurrentTask,
  type TaskLogEntry,
} from "./burnup";

const origin = new Date("2026-09-01T08:00:00Z");
const at = (day: string, time = "10:00") => new Date(`2026-09-${day}T${time}:00Z`);
let nextLog = 1;
const entry = (
  taskId: number,
  field: TaskLogEntry["field"],
  newValue: string | null,
  when: Date,
  logId = nextLog++,
): TaskLogEntry => ({ taskId, field, newValue, at: when, logId });

const sample = (entries: TaskLogEntry[], current: CurrentTask[], now = at("30")) => {
  const lives = replayTasks(entries, current, origin);
  return sampleBurnup(lives, dayKeys(origin, now), now);
};
const on = (points: BurnupPoint[], day: string) => {
  const p = points.find((x) => x.day === `2026-09-${day}`);
  return p && { scope: p.scope, done: p.done };
};

describe("replayTasks and sampleBurnup", () => {
  it("counts a task done from the day its state changes", () => {
    const points = sample(
      [entry(1, "created", null, at("02")), entry(1, "state", "done", at("05"))],
      [{ id: 1, state: "done" }],
    );
    expect(on(points, "04")).toEqual({ scope: 1, done: 0 });
    expect(on(points, "05")).toEqual({ scope: 1, done: 1 });
  });

  it("uses origin as creation time and the current state without entries", () => {
    const points = sample([], [{ id: 1, state: "done" }]);
    expect(on(points, "01")).toEqual({ scope: 1, done: 1 });
  });

  it("removes a deleted task from scope and done", () => {
    const points = sample(
      [
        entry(1, "created", null, at("02")),
        entry(1, "state", "done", at("03")),
        entry(1, "deleted", null, at("06")),
      ],
      [],
    );
    expect(on(points, "05")).toEqual({ scope: 1, done: 1 });
    expect(on(points, "06")).toEqual({ scope: 0, done: 0 });
  });

  it("ignores entries after the deletion", () => {
    const lives = replayTasks(
      [
        entry(1, "created", null, at("02")),
        entry(1, "deleted", null, at("06")),
        entry(1, "state", "done", at("07")),
      ],
      [],
      origin,
    );
    expect(lives[0].deletedAt).toEqual(at("06"));
    expect(lives[0].states).toEqual([{ at: at("02"), state: "todo" }]);
  });

  it("does not change counts for systemId or moved entries", () => {
    const points = sample(
      [
        entry(1, "created", null, at("02")),
        entry(1, "moved", "7", at("04")),
        { taskId: 1, field: "moved", newValue: null, at: at("05"), logId: 99 },
      ],
      [{ id: 1, state: "todo" }],
    );
    for (const p of points.filter((x) => x.day >= "2026-09-02")) expect(p.scope).toBe(1);
  });

  it("trusts the current row over a lost log entry", () => {
    const points = sample(
      [entry(1, "created", null, at("02")), entry(1, "state", "doing", at("03")), entry(1, "state", "done", at("04"))],
      [{ id: 1, state: "todo" }],
    );
    expect(on(points, "04")).toEqual({ scope: 1, done: 0 });
    expect(on(points, "30")).toEqual({ scope: 1, done: 0 });
  });

  it("treats a task missing from current without a deleted entry as deleted at its last entry", () => {
    const points = sample([entry(1, "created", null, at("02")), entry(1, "state", "done", at("04"))], []);
    expect(on(points, "03")).toEqual({ scope: 1, done: 0 });
    expect(on(points, "05")).toEqual({ scope: 0, done: 0 });
  });

  it("counts only the first created entry", () => {
    const lives = replayTasks(
      [entry(1, "created", null, at("02")), entry(1, "created", null, at("09"))],
      [{ id: 1, state: "todo" }],
      origin,
    );
    expect(lives).toHaveLength(1);
    expect(lives[0].createdAt).toEqual(at("02"));
  });

  it("samples the current day at now, not at the end of the day", () => {
    const now = at("10", "12:00");
    const points = sample(
      [entry(1, "created", null, at("02")), entry(1, "state", "done", at("10", "13:00"))],
      [{ id: 1, state: "done" }],
      now,
    );
    expect(on(points, "10")).toEqual({ scope: 1, done: 0 });
    expect(points.at(-1)?.day).toBe("2026-09-10");
  });

  it("keeps 0 <= done <= scope with finite numbers for random histories", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const fields = ["created", "state", "deleted", "moved"] as const;
    const states: TaskState[] = ["todo", "doing", "blocked", "done"];
    const entries: TaskLogEntry[] = [];
    for (let i = 0; i < 200; i++) {
      const field = fields[Math.floor(rand() * fields.length)];
      const day = 1 + Math.floor(rand() * 29);
      entries.push({
        taskId: 1 + Math.floor(rand() * 25),
        field,
        newValue: field === "state" ? states[Math.floor(rand() * 4)] : field === "moved" ? "3" : null,
        at: new Date(Date.UTC(2026, 8, day, Math.floor(rand() * 24))),
        logId: i + 1,
      });
    }
    const current: CurrentTask[] = [];
    for (let id = 1; id <= 25; id++) if (rand() < 0.6) current.push({ id, state: states[Math.floor(rand() * 4)] });
    const points = sample(entries, current);
    expect(points).toHaveLength(30);
    for (const p of points) {
      expect(Number.isFinite(p.scope) && Number.isFinite(p.done)).toBe(true);
      expect(p.done).toBeGreaterThanOrEqual(0);
      expect(p.done).toBeLessThanOrEqual(p.scope);
    }
  });
});

describe("projectFinish", () => {
  const series = (n: number, done: (i: number) => number, scope = 40): BurnupPoint[] =>
    Array.from({ length: n }, (_, i) => ({ day: addDays("2026-09-01", i), scope, done: done(i) }));

  it("projects a range from a steady pace", () => {
    const points = series(20, (i) => i);
    const last = points.at(-1)!.day;
    expect(projectFinish(points)).toEqual({
      status: "range",
      paceLow: 0.8,
      paceHigh: 1.15,
      earliest: addDays(last, 19),
      latest: addDays(last, 27),
    });
  });

  it("answers none when nothing moved, history is short, and done when finished", () => {
    expect(projectFinish(series(20, () => 3))).toEqual({ status: "none", reason: "no-pace" });
    expect(projectFinish(series(5, (i) => i))).toEqual({ status: "none", reason: "too-little-history" });
    expect(projectFinish(series(20, () => 40))).toEqual({ status: "done" });
    expect(projectFinish([])).toEqual({ status: "none", reason: "too-little-history" });
  });

  it("uses the earliest point for 7 to 14 points", () => {
    const result = projectFinish(series(8, (i) => i * 2));
    expect(result.status).toBe("range");
  });

  it("never returns a range that starts before the last day", () => {
    for (let n = 0; n < 40; n++) {
      for (const scope of [0, 5, 40]) {
        for (const rate of [0, 1, 3]) {
          const points = series(n, (i) => Math.min(scope, i * rate), scope);
          const result = projectFinish(points);
          if (result.status === "range") {
            expect(result.earliest >= points.at(-1)!.day).toBe(true);
            expect(result.latest >= result.earliest).toBe(true);
          }
        }
      }
    }
  });
});
