import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown";

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

  it("opens links in a new tab without referrer", () => {
    const html = renderToStaticMarkup(<Markdown>{"[repo](https://github.com/x/y)"}</Markdown>);
    expect(html).toContain('href="https://github.com/x/y"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain('target="_blank"');
  });
});
