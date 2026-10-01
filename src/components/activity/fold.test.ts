import { describe, expect, it } from "vitest";
import { foldActivity, type FoldedGroup } from "./fold";
import type { ChangeTimelineItem, TimelineItem, UpdateTimelineItem } from "./timeline";

const MIN = 60_000;
const BASE = Date.parse("2026-09-30T18:10:00.000Z");

/** A change `minutesAgo` before 18:10 UTC. */
function change(n: number, minutesAgo: number, over: Partial<ChangeTimelineItem> = {}): ChangeTimelineItem {
  return {
    kind: "change",
    key: `c-${n}`,
    createdAt: new Date(BASE - minutesAgo * MIN).toISOString(),
    authorName: "Claude Code for Ammo",
    agent: null,
    sentence: { verb: "edited", target: null, targetIsSystem: false },
    systemSlug: null,
    toCategory: null,
    ...over,
  };
}

function update(n: number, minutesAgo: number): UpdateTimelineItem {
  return {
    kind: "update",
    key: `u-${n}`,
    createdAt: new Date(BASE - minutesAgo * MIN).toISOString(),
    authorName: "Claude Code for Ammo",
    agent: null,
    systemSlug: "s",
    systemTitle: "S",
    taskTitle: null,
    summary: "x",
    nextStep: null,
    commitHash: null,
    commitUrl: null,
  };
}

describe("foldActivity", () => {
  it("folds five changes a minute apart into one group", () => {
    const items = [0, 1, 2, 3, 4].map((i) => change(i, i));
    const out = foldActivity(items);
    expect(out).toHaveLength(1);
    const g = out[0] as FoldedGroup;
    expect(g.kind).toBe("fold");
    expect(g.items).toHaveLength(5);
    expect(g.key).toBe("f-c-0");
    expect(g.to).toBe(items[0].createdAt);
    expect(g.from).toBe(items[4].createdAt);
  });

  it("splits a run at a gap longer than the window", () => {
    const items = [change(0, 0), change(1, 1), change(2, 7), change(3, 8), change(4, 9)];
    const out = foldActivity(items);
    expect(out.map((o) => o.kind)).toEqual(["change", "change", "fold"]);
    expect((out[2] as FoldedGroup).items).toHaveLength(3);
  });

  it("splits a run at an update", () => {
    const items: TimelineItem[] = [change(0, 0), change(1, 1), update(2, 2), change(3, 3), change(4, 4)];
    expect(foldActivity(items).map((o) => o.kind)).toEqual(["change", "change", "update", "change", "change"]);
    const long: TimelineItem[] = [change(0, 0), change(1, 1), change(2, 2), update(3, 2), change(4, 3), change(5, 4), change(6, 5)];
    expect(foldActivity(long).map((o) => o.kind)).toEqual(["fold", "update", "fold"]);
  });

  it("does not fold different agents of the same person", () => {
    const items = [change(0, 0, { agent: "claude" }), change(1, 1, { agent: "codex" }), change(2, 2, { agent: "claude" })];
    expect(foldActivity(items).every((o) => o.kind === "change")).toBe(true);
  });

  it("splits a run at UTC midnight", () => {
    const at = (iso: string, n: number) => change(n, 0, { createdAt: iso });
    const items = [
      at("2026-10-01T00:02:00.000Z", 0),
      at("2026-10-01T00:01:00.000Z", 1),
      at("2026-10-01T00:00:30.000Z", 2),
      at("2026-09-30T23:59:30.000Z", 3),
      at("2026-09-30T23:59:00.000Z", 4),
      at("2026-09-30T23:58:00.000Z", 5),
    ];
    const out = foldActivity(items);
    expect(out.map((o) => o.kind)).toEqual(["fold", "fold"]);
    expect((out[0] as FoldedGroup).items).toHaveLength(3);
    expect((out[1] as FoldedGroup).items).toHaveLength(3);
  });

  it("lists distinct systems in order of first appearance", () => {
    const sys = (title: string) => ({ systemTitle: title });
    const items = [change(0, 0, sys("B")), change(1, 1, sys("A")), change(2, 2, sys("B")), change(3, 3, sys("C"))];
    expect((foldActivity(items)[0] as FoldedGroup).systemTitles).toEqual(["B", "A", "C"]);
  });
});
