import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";

export interface Heading {
  depth: 1 | 2 | 3;
  text: string;
  id: string;
}

/**
 * The h1-h3 headings of a markdown document in order, with the ids rehype-slug
 * gives them when rendered. Every heading, also h4-h6, goes through the slugger
 * so duplicate counters (`scope`, `scope-1`) match the rendered ids.
 */
export function extractHeadings(markdown: string): Heading[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  visit(tree, "heading", (node) => {
    // Rendered text has no image alt text, which mdast-util-to-string would include.
    const clone = structuredClone(node);
    visit(clone, (child, index, parent) => {
      if ((child.type === "image" || child.type === "imageReference") && parent && index !== undefined) {
        parent.children.splice(index, 1);
        return [SKIP, index];
      }
    });
    const text = toString(clone);
    const id = slugger.slug(text);
    if (node.depth <= 3) headings.push({ depth: node.depth as 1 | 2 | 3, text, id });
  });
  return headings;
}
