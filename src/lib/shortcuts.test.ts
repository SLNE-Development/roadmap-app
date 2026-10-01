import { describe, expect, it } from "vitest";
import { isTypingTarget, SHORTCUTS, ShortcutMatcher } from "./shortcuts";

describe("ShortcutMatcher", () => {
  it("waits on a sequence prefix and matches the second key", () => {
    const m = new ShortcutMatcher(SHORTCUTS);
    expect(m.press("g", 0)).toBeNull();
    expect(m.press("b", 500)).toEqual({ go: "boards" });
  });

  it("resets after the timeout", () => {
    const m = new ShortcutMatcher(SHORTCUTS);
    expect(m.press("g", 0)).toBeNull();
    expect(m.press("b", 1500)).toBeNull();
  });

  it("matches single keys immediately and ignores unknown ones", () => {
    const m = new ShortcutMatcher(SHORTCUTS);
    expect(m.press("c", 0)).toEqual({ event: "new-system" });
    expect(m.press("x", 0)).toBeNull();
    expect(m.press("?", 0)).toEqual({ event: "help" });
  });

  it("resets on an unknown second key", () => {
    const m = new ShortcutMatcher(SHORTCUTS);
    m.press("g", 0);
    expect(m.press("x", 100)).toBeNull();
    expect(m.press("c", 200)).toEqual({ event: "new-system" });
  });

  it("compares keys case-sensitively", () => {
    const m = new ShortcutMatcher(SHORTCUTS);
    expect(m.press("C", 0)).toBeNull();
  });
});

describe("isTypingTarget", () => {
  it("is true for form controls, contenteditable and dialog content", () => {
    expect(isTypingTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", closest: (s) => (s === "[cmdk-root]" ? {} : null) })).toBe(true);
    expect(isTypingTarget({ tagName: "BUTTON", closest: (s) => (s === '[role="dialog"]' ? {} : null) })).toBe(true);
  });

  it("is false otherwise", () => {
    expect(isTypingTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTypingTarget({ tagName: "DIV", closest: () => null })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
