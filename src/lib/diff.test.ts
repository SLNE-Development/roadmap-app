import { describe, expect, it } from "vitest";
import { diffDocuments, unifiedDiff } from "./diff";

describe("diffDocuments", () => {
  it("finds no hunks for identical bodies", () => {
    expect(diffDocuments("# A\n\ntext\n", "# A\n\ntext\n")).toEqual({ hunks: [], added: 0, removed: 0 });
  });

  it("pairs a changed line and marks the changed words under the nearest heading", () => {
    const { hunks, added, removed } = diffDocuments("## Scope\n- rebuild nightly\n", "## Scope\n- rebuild on every write\n");
    expect(added).toBe(1);
    expect(removed).toBe(1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toBe("## Scope");
    const del = hunks[0].lines.filter((l) => l.kind === "del");
    const add = hunks[0].lines.filter((l) => l.kind === "add");
    expect(del).toHaveLength(1);
    expect(add).toHaveLength(1);
    const changed = (parts: { text: string; changed: boolean }[]) => parts.filter((p) => p.changed).map((p) => p.text).join("").trim();
    expect(changed(add[0].parts)).toBe("on every write");
    expect(changed(del[0].parts)).toBe("nightly");
  });

  it("numbers an appended line on the new side only", () => {
    const { hunks, added, removed } = diffDocuments("one\ntwo\n", "one\ntwo\nthree\n");
    expect(added).toBe(1);
    expect(removed).toBe(0);
    const line = hunks[0].lines.find((l) => l.kind === "add");
    expect(line).toMatchObject({ oldNo: null, newNo: 3 });
  });

  it("falls back to a range header without a heading and keeps three lines of context", () => {
    const old = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const next = old.replace("line 10\n", "changed\n");
    const { hunks } = diffDocuments(old, next);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toBe("@@ -7,7 +7,7 @@");
    expect(hunks[0].lines).toHaveLength(8);
  });

  it("diffs two 200 000-character bodies with 50 changed lines in under 2 seconds", () => {
    const lines = Array.from({ length: 4000 }, (_, i) => `line ${i} ${"x".repeat(40)}`);
    const changed = lines.map((l, i) => (i % 80 === 0 ? `${l} edited` : l));
    const a = lines.join("\n") + "\n";
    const b = changed.join("\n") + "\n";
    expect(a.length).toBeGreaterThanOrEqual(200_000);
    const start = performance.now();
    const { added, removed } = diffDocuments(a, b);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(added).toBe(50);
    expect(removed).toBe(50);
  });
});

describe("unifiedDiff", () => {
  it("produces a patch with the labels", () => {
    const patch = unifiedDiff("a\n", "b\n", "spec v1", "spec v2");
    expect(patch).toContain("--- spec v1");
    expect(patch).toContain("+++ spec v2");
    expect(patch).toContain("-a");
    expect(patch).toContain("+b");
  });
});
