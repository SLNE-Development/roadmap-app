import { describe, expect, it } from "vitest";
import { extractHeadings } from "./headings";

const MD = "# Intro\n## Scope\n## Scope\n### Übersicht 🚀\n## `code` step\n#### deep\n```\n# not a heading\n```";

describe("extractHeadings", () => {
  it("returns depth 1-3 headings with unique github-slugger ids", () => {
    const headings = extractHeadings(MD);
    expect(headings.map((h) => h.id)).toEqual(["intro", "scope", "scope-1", "übersicht-", "code-step"]);
    expect(headings.map((h) => h.depth)).toEqual([1, 2, 2, 3, 2]);
    expect(headings.slice(1).map((h) => h.text)).toEqual(["Scope", "Scope", "Übersicht 🚀", "code step"]);
  });

  it("counts deeper headings so duplicate suffixes match the rendered ids", () => {
    const headings = extractHeadings("## Notes\n#### Notes\n## Notes");
    expect(headings.map((h) => h.id)).toEqual(["notes", "notes-2"]);
  });
});
