import { describe, expect, it } from "vitest";
import { continueList, indentLines, insertBlock, insertLink, toggleLinePrefix, wrapSelection } from "./markdown-edit";

const sel = (value: string, start: number, end = start) => ({ value, start, end });

describe("wrapSelection", () => {
  it("wraps the selection and keeps it selected", () => {
    expect(wrapSelection(sel("abc", 0, 3), "**", "**", "bold")).toEqual(sel("**abc**", 2, 5));
  });

  it("inserts the selected placeholder without a selection", () => {
    expect(wrapSelection(sel("a ", 2), "*", "*", "italic")).toEqual(sel("a *italic*", 3, 9));
  });

  it("unwraps a selection that is already wrapped", () => {
    expect(wrapSelection(sel("**abc**", 2, 5), "**", "**", "bold")).toEqual(sel("abc", 0, 3));
  });
});

describe("toggleLinePrefix", () => {
  it("adds and removes a heading marker", () => {
    const on = toggleLinePrefix(sel("title", 2), "# ");
    expect(on.value).toBe("# title");
    expect(toggleLinePrefix(on, "# ").value).toBe("title");
  });

  it("prefixes every selected line", () => {
    expect(toggleLinePrefix(sel("a\nb\nc", 0, 3), "> ").value).toBe("> a\n> b\nc");
  });

  it("swaps another heading level for the prefix", () => {
    expect(toggleLinePrefix(sel("## t", 0), "# ").value).toBe("# t");
  });
});

describe("insertLink", () => {
  it("selects the url placeholder", () => {
    const next = insertLink(sel("see docs", 4, 8));
    expect(next.value).toBe("see [docs](https://)");
    expect(next.value.slice(next.start, next.end)).toBe("https://");
  });
});

describe("insertBlock", () => {
  it("puts the block on its own lines", () => {
    expect(insertBlock(sel("abc", 3), "---").value).toBe("abc\n---\n");
  });
});

describe("continueList", () => {
  it("continues a numbered list with the next number", () => {
    expect(continueList(sel("1. x", 4))).toEqual(sel("1. x\n2. ", 8));
  });

  it("continues bullets and fresh task items", () => {
    expect(continueList(sel("- x", 3))?.value).toBe("- x\n- ");
    expect(continueList(sel("- [x] done", 10))?.value).toBe("- [x] done\n- [ ] ");
  });

  it("ends the list on an empty item", () => {
    expect(continueList(sel("a\n- ", 4))).toEqual(sel("a\n", 2));
  });

  it("returns null outside a list", () => {
    expect(continueList(sel("plain", 5))).toBeNull();
  });
});

describe("indentLines", () => {
  it("adds two spaces to each selected line", () => {
    expect(indentLines(sel("- a\n- b", 0, 7), false).value).toBe("  - a\n  - b");
  });

  it("removes up to two spaces when outdenting", () => {
    expect(indentLines(sel("  - a\n - b", 0, 10), true).value).toBe("- a\n- b");
  });
});
