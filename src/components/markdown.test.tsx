import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { extractHeadings } from "@/lib/headings";
import type { GlossaryTerm } from "@/lib/glossary-match";
import { Markdown } from "./markdown";
import { TooltipProvider } from "./ui/tooltip";

describe("Markdown", () => {
  it("renders GitHub-flavoured markdown", () => {
    const html = renderToStaticMarkup(<Markdown>{"# Title\n\n- [x] done\n\n| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>);
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("<table>");
  });

  it("drops raw HTML and neutralises javascript links", () => {
    const html = renderToStaticMarkup(
      <Markdown>{'<script>alert(1)</script><img src=x onerror="alert(2)">\n\n[click](javascript:alert(3))'}</Markdown>,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    expect(html).toContain("click");
  });

  it("draws mention tokens as chips that are not links", () => {
    const html = renderToStaticMarkup(<Markdown>{"hi [@Rik](user:0190c0de-0000-7000-8000-000000000001)"}</Markdown>);
    expect(html).toMatch(/<span[^>]*>@Rik<\/span>/);
    expect(html).not.toContain("href");
    expect(html).not.toContain("<a");
  });

  it("draws mentions of Better Auth user ids as chips", () => {
    const html = renderToStaticMarkup(<Markdown>{"[@Ammo](user:WjfU86uAv39fliVDHVg25eKwQdOlvSuH) hi"}</Markdown>);
    expect(html).toMatch(/<span[^>]*>@Ammo<\/span>/);
    expect(html).not.toContain("<a");
  });

  it("still removes javascript hrefs next to mentions", () => {
    const html = renderToStaticMarkup(<Markdown>{"[x](javascript:alert(1)) [@Rik](user:0190c0de-0000-7000-8000-000000000001)"}</Markdown>);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("@Rik");
  });

  it("opens links in a new tab without referrer", () => {
    const html = renderToStaticMarkup(<Markdown>{"[repo](https://github.com/x/y)"}</Markdown>);
    expect(html).toContain('href="https://github.com/x/y"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });

  it("gives headings the same ids as extractHeadings when headingIds is set", () => {
    const md = "# Intro\n## Scope\n## Scope\n### Übersicht 🚀\n## `code` step\n#### deep\n```\n# not a heading\n```";
    const html = renderToStaticMarkup(<Markdown headingIds>{md}</Markdown>);
    const ids = [...html.matchAll(/<h[1-3] id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toEqual(extractHeadings(md).map((h) => h.id));
    expect(html).toContain('href="#scope-1"');
    expect(html).toContain('aria-label="Link to section Scope"');
  });

  it("keeps ids equal to extractHeadings for headings with a link and an image", () => {
    const md = "## See [the docs](https://example.com) now\n### Logo ![alt text](https://example.com/a.png) here\n## See [the docs](https://example.com) now";
    const html = renderToStaticMarkup(<Markdown headingIds>{md}</Markdown>);
    const ids = [...html.matchAll(/<h[1-3] id="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toEqual(extractHeadings(md).map((h) => h.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows a state chip after the heading of a step with a task", () => {
    const html = renderToStaticMarkup(
      <Markdown stepStates={new Map([[1, { taskId: 9, state: "doing" }]])}>{"## Step 1: Build\n## Step 2: Ship"}</Markdown>,
    );
    expect(html.match(/Doing/g)).toHaveLength(1);
    expect(html.indexOf("Doing")).toBeLessThan(html.indexOf("Step 2"));
  });

  it("adds no ids without headingIds", () => {
    const html = renderToStaticMarkup(<Markdown>{"# Intro\n## Scope"}</Markdown>);
    expect(html).not.toContain("id=");
  });

  describe("glossary", () => {
    const glossary: GlossaryTerm[] = [{ id: "1", term: "Outbox", definition: "Queue table", aliases: [] }];
    const render = (md: string) =>
      renderToStaticMarkup(
        <TooltipProvider>
          <Markdown headingIds glossary={glossary}>
            {md}
          </Markdown>
        </TooltipProvider>,
      );

    it("marks the first whole-word occurrence as a focusable term", () => {
      const html = render("The outbox feeds workers. The outbox again.");
      expect(html.match(/<abbr/g)).toHaveLength(1);
      expect(html).toContain('tabindex="0"');
      expect(html).toContain("data-glossary");
    });

    it("leaves headings, code and links unwrapped and headings linked", () => {
      const html = render("## Outbox\n\n`outbox` [outbox](https://x)");
      expect(html).not.toContain("<abbr");
      expect(html).toContain('aria-label="Link to section Outbox"');
    });

    it("changes nothing without a glossary", () => {
      expect(renderToStaticMarkup(<Markdown>{"The outbox."}</Markdown>)).not.toContain("<abbr");
    });
  });
});
