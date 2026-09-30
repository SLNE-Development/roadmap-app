import { describe, expect, it } from "vitest";
import { mergeColumnCounts, type DraftColumn } from "./column-draft";

describe("mergeColumnCounts", () => {
  it("refreshes system counts and keeps every other draft field", () => {
    const draft: DraftColumn[] = [
      { key: "a", id: "a", name: "Todo (renamed)", category: "todo", systemCount: 0 },
      { key: "n1", name: "New", category: "review", systemCount: 0 },
    ];
    const merged = mergeColumnCounts(draft, [{ id: "a", systemCount: 3 }]);
    expect(merged[0]).toEqual({ key: "a", id: "a", name: "Todo (renamed)", category: "todo", systemCount: 3 });
    expect(merged[1]).toEqual(draft[1]);
  });
});
