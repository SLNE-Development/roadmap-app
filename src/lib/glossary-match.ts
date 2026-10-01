import type { Element, ElementContent, Root, Text } from "hast";
import { SKIP, visit } from "unist-util-visit";

/** A glossary term as the document renderer needs it. */
export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  aliases: string[];
}

/** Elements whose text is never highlighted. */
const SKIPPED = new Set(["code", "pre", "a", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** Escapes regex metacharacters. */
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A rehype plugin that wraps the first whole-word, case-insensitive occurrence of each glossary
 * term or alias in an `abbr` carrying the definition. Text inside code, links and headings is
 * left alone; longer terms match first. Word boundaries are Unicode letters, digits and `_`.
 */
export function rehypeGlossary(terms: GlossaryTerm[]): () => (tree: Root) => void {
  const entries = terms
    .flatMap((t) => [t.term, ...t.aliases].map((word) => ({ word: word.toLowerCase(), term: t })))
    .sort((a, b) => b.word.length - a.word.length);
  const byWord = new Map(entries.map((e) => [e.word, e.term]));
  return () => (tree) => {
    if (entries.length === 0) return;
    // Terms already highlighted: a term and its aliases share one occurrence.
    const done = new Set<GlossaryTerm>();
    visit(tree, (node, index, parent) => {
      if (node.type === "element" && SKIPPED.has((node as Element).tagName)) return SKIP;
      if (node.type !== "text" || !parent || index === undefined) return;
      const text = (node as Text).value;
      const pending = [...byWord].filter(([, t]) => !done.has(t)).map(([w]) => w);
      if (pending.length === 0) return;
      const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(${pending.map(escape).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
      const out: ElementContent[] = [];
      let last = 0;
      for (const m of text.matchAll(regex)) {
        const found = byWord.get(m[1].toLowerCase());
        if (!found || done.has(found)) continue;
        done.add(found);
        if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
        out.push({
          type: "element",
          tagName: "abbr",
          properties: { title: found.definition, dataGlossary: "" },
          children: [{ type: "text", value: m[1] }],
        });
        last = m.index + m[1].length;
      }
      if (out.length === 0) return;
      if (last < text.length) out.push({ type: "text", value: text.slice(last) });
      parent.children.splice(index, 1, ...out);
      return index + out.length;
    });
  };
}
