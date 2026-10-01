import { describe, expect, it } from "vitest";
import { columnIdAt, focusReady, moveKey, moveTargets } from "./board-moves";

const cols = [{ id: "a" }, { id: "b" }, { id: "c" }];
const plain = { altKey: false, shiftKey: false, ctrlKey: false, metaKey: false };

describe("moveTargets", () => {
  it("returns the neighbouring columns", () => {
    expect(moveTargets(cols, "b")).toEqual({ left: "a", right: "c" });
  });

  it("returns null at either end", () => {
    expect(moveTargets(cols, "a").left).toBeNull();
    expect(moveTargets(cols, "c").right).toBeNull();
  });
});

describe("moveKey", () => {
  it("reads Alt+Arrow", () => {
    expect(moveKey({ ...plain, key: "ArrowRight", altKey: true })).toBe("right");
    expect(moveKey({ ...plain, key: "ArrowLeft", altKey: true })).toBe("left");
  });

  it("ignores other combinations", () => {
    expect(moveKey({ ...plain, key: "ArrowRight" })).toBeNull();
    expect(moveKey({ ...plain, key: "ArrowRight", altKey: true, shiftKey: true })).toBeNull();
    expect(moveKey({ ...plain, key: "ArrowLeft", altKey: true, ctrlKey: true })).toBeNull();
  });
});

describe("columnIdAt", () => {
  const node = (attrs: Record<string, string>, parentElement: unknown = null) =>
    ({ getAttribute: (name: string) => attrs[name] ?? null, parentElement }) as unknown as Element;

  it("returns the nearest ancestor's column id", () => {
    const outer = node({ "data-column-id": "outer" });
    const column = node({ "data-column-id": "col" }, outer);
    const leaf = node({}, column);
    expect(columnIdAt({ x: 1, y: 2 }, () => leaf)).toBe("col");
  });

  it("returns null without a column", () => {
    expect(columnIdAt({ x: 1, y: 2 }, () => node({}, node({})))).toBeNull();
    expect(columnIdAt({ x: 1, y: 2 }, () => null)).toBeNull();
  });
});

describe("focusReady", () => {
  it("waits for the card to reach its target column", () => {
    expect(focusReady({ columnId: "a" }, "a")).toBe(true);
    expect(focusReady({ columnId: "a" }, "b")).toBe(false);
    expect(focusReady({ columnId: "a" }, null)).toBe(false);
  });
});
