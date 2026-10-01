import { describe, expect, it } from "vitest";
import { ACTIVITY_GROUPS, groupEntities, nextActivityCursor, parseGroups } from "./activity-groups";

describe("ACTIVITY_GROUPS", () => {
  it("maps the newer entities to their groups", () => {
    expect(ACTIVITY_GROUPS.systems.entities).toContain("code");
    expect(ACTIVITY_GROUPS.structure.entities).toEqual(expect.arrayContaining(["release", "repo", "webhook"]));
    expect(groupEntities(["documents", "decisions"])).toEqual(["document", "planning", "adr"]);
  });
});

describe("parseGroups", () => {
  it("keeps known keys once, in group order, and drops the rest", () => {
    expect(parseGroups("tasks,systems")).toEqual(["systems", "tasks"]);
    expect(parseGroups("tasks,bogus,tasks")).toEqual(["tasks"]);
    expect(parseGroups(undefined)).toEqual([]);
    expect(parseGroups("")).toEqual([]);
  });
});

describe("nextActivityCursor", () => {
  it("returns the oldest id of a full page only", () => {
    expect(nextActivityCursor([{ id: 9 }, { id: 8 }], 2)).toBe(8);
    expect(nextActivityCursor([{ id: "b" }, { id: "a" }], 2)).toBe("a");
    expect(nextActivityCursor([{ id: 9 }], 2)).toBeUndefined();
    expect(nextActivityCursor([], 2)).toBeUndefined();
  });
});
