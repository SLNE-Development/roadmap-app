import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { rehypeGlossary, type GlossaryTerm } from "./glossary-match";

const terms: GlossaryTerm[] = [
  { id: "1", term: "Outbox", definition: "Queue table of pending events", aliases: ["outbox table"] },
  { id: "2", term: "test", definition: "A check", aliases: [] },
  { id: "3", term: "Übergabe", definition: "Handover", aliases: [] },
];

function render(markdown: string, glossary = terms): string {
  return String(unified().use(remarkParse).use(remarkRehype).use(rehypeGlossary(glossary)).use(rehypeStringify).processSync(markdown));
}

describe("rehypeGlossary", () => {
  it("wraps only the first occurrence, the longer alias winning", () => {
    const html = render("The outbox table feeds workers. The outbox again.");
    expect(html.match(/<abbr/g)).toHaveLength(1);
    expect(html).toContain("outbox table</abbr>");
    expect(html).toContain('title="Queue table of pending events"');
    expect(html).toContain("data-glossary");
  });

  it("does not wrap a term inside another word", () => {
    expect(render("testing tests")).not.toContain("<abbr");
  });

  it("does not wrap inside code, a link or a heading", () => {
    expect(render("`test` and [test](https://x)\n\n## test")).not.toContain("<abbr");
  });

  it("wraps a whole word", () => {
    expect(render("A test.")).toContain("<abbr");
  });

  it("matches unicode words", () => {
    expect(render("die Übergabe.")).toContain("Übergabe</abbr>");
  });

  it("matches regex metacharacters in terms literally", () => {
    const special: GlossaryTerm[] = [
      { id: "1", term: "C++", definition: "A language", aliases: [] },
      { id: "2", term: "a.b", definition: "A dotted name", aliases: ["f(x", "x|y"] },
    ];
    expect(render("axb", special)).not.toContain("<abbr");
    expect(render("a.b", special)).toContain("a.b</abbr>");
    expect(render("C++ rocks", special)).toContain("C++</abbr>");
    expect(() => render("f(x and x|y", special)).not.toThrow();
    expect(render("call f(x now", special)).toContain("f(x</abbr>");
  });
});
