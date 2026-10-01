import { describe, expect, it } from "vitest";
import type { BoardCardView } from "./board-card";
import { groupIntoLanes, type LaneNames } from "./lanes";

function card(slug: string, over: Partial<BoardCardView>): BoardCardView {
  return {
    slug,
    title: slug,
    priority: "MVP",
    ownerUserId: null,
    ownerName: null,
    domainId: null,
    phaseId: null,
    columnId: "todo",
    planningAreasCovered: 0,
    planningRounds: 0,
    tasksDone: 0,
    tasksTotal: 0,
    openQuestions: 0,
    points: 0,
    pointsDone: 0,
    blockedBy: [],
    fields: {},
    latestSummary: null,
    ...over,
  };
}

const names: LaneNames = {
  domains: new Map([
    ["d1", "Core"],
    ["d2", "Edge"],
  ]),
  phases: new Map([["p1", "Alpha"]]),
  domainOrder: ["d1", "d2"],
  phaseOrder: ["p1"],
};

const cards = [
  card("a", { domainId: "d2", ownerUserId: "u2", ownerName: "Zed", columnId: "todo", priority: "Later" }),
  card("b", { domainId: "d1", ownerUserId: "u1", ownerName: "Ann", columnId: "doing", priority: "Nice to have" }),
  card("c", { domainId: "d1", ownerUserId: "u1", ownerName: "Ann", columnId: "todo" }),
  card("d", { columnId: "doing", ownerUserId: "u2", ownerName: "Zed", phaseId: "p1" }),
  card("e", { domainId: "d2", columnId: "todo" }),
];

describe("groupIntoLanes", () => {
  it("orders domain lanes by structure with No domain last", () => {
    const lanes = groupIntoLanes(cards, "domain", names);
    expect(lanes.map((l) => l.key)).toEqual(["d1", "d2", "__none"]);
    expect(lanes.map((l) => l.name)).toEqual(["Core", "Edge", "No domain"]);
    expect(lanes[0].countByColumn).toEqual({ doing: 1, todo: 1 });
    expect(lanes[1].countByColumn).toEqual({ todo: 2 });
    expect(lanes[2].countByColumn).toEqual({ doing: 1 });
  });

  it("sorts owner lanes by name with Unassigned last", () => {
    const lanes = groupIntoLanes(cards, "owner", names);
    expect(lanes.map((l) => l.name)).toEqual(["Ann", "Zed", "Unassigned"]);
    expect(lanes[2].key).toBe("__none");
  });

  it("follows the priority order and skips empty priorities", () => {
    expect(groupIntoLanes(cards, "priority", names).map((l) => l.name)).toEqual(["MVP", "Later", "Nice to have"]);
    const mvpOnly = groupIntoLanes([cards[2]], "priority", names);
    expect(mvpOnly.map((l) => l.name)).toEqual(["MVP"]);
  });

  it("groups by phase with No phase last", () => {
    expect(groupIntoLanes(cards, "phase", names).map((l) => l.name)).toEqual(["Alpha", "No phase"]);
  });

  it("returns one lane with all cards for none", () => {
    const lanes = groupIntoLanes(cards, "none", names);
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({ key: "all", name: "" });
    expect(lanes[0].cards).toHaveLength(5);
    expect(lanes[0].countByColumn).toEqual({ todo: 3, doing: 2 });
  });
});
