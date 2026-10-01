import { describe, expect, it } from "vitest";
import { diffDocuments, unifiedDiff } from "./diff";

/** Two ~200 000-character bodies of 10-character lines that share no line. */
function fullRewrite(): { a: string; b: string } {
  const a = Array.from({ length: 20_000 }, (_, i) => `old${String(i).padStart(6, "0")}\n`).join("");
  const b = Array.from({ length: 20_000 }, (_, i) => `new${String(i).padStart(6, "0")}\n`).join("");
  return { a, b };
}

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

  it("gives up on a full rewrite of two 200 000-character bodies within 2 seconds and counts every line", () => {
    const { a, b } = fullRewrite();
    expect(a.length).toBeGreaterThanOrEqual(200_000);
    const start = performance.now();
    const { hunks, added, removed } = diffDocuments(a, b);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(added).toBe(20_000);
    expect(removed).toBe(20_000);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].lines).toHaveLength(40_000);
  });

  it("marks a fully rewritten 200 000-character line as one changed part within 2 seconds", () => {
    const line = (prefix: string) => Array.from({ length: 25_000 }, (_, i) => `${prefix}${String(i).padStart(6, "0")} `).join("");
    const a = line("o");
    const b = line("n");
    expect(a.length).toBe(200_000);
    const start = performance.now();
    const { hunks, added, removed } = diffDocuments(`${a}\n`, `${b}\n`);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(added).toBe(1);
    expect(removed).toBe(1);
    const [del, add] = hunks[0].lines;
    expect(del.parts).toEqual([{ text: a, changed: true }]);
    expect(add.parts).toEqual([{ text: b, changed: true }]);
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

  it("removes every old line and adds every new one when a full rewrite takes too long", () => {
    const { a, b } = fullRewrite();
    const start = performance.now();
    const patch = unifiedDiff(a, b, "spec v1", "spec v2");
    expect(performance.now() - start).toBeLessThan(2000);
    expect(patch).toContain("--- spec v1");
    expect(patch).toContain("@@ -1,20000 +1,20000 @@");
    const lines = patch.split("\n");
    expect(lines.filter((l) => l.startsWith("-old"))).toHaveLength(20_000);
    expect(lines.filter((l) => l.startsWith("+new"))).toHaveLength(20_000);
  });
});
