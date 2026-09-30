import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorScreen, NotFoundScreen } from "./status-screens";

describe("NotFoundScreen", () => {
  it("renders the title as the page heading, the text and the action", () => {
    const html = renderToStaticMarkup(<NotFoundScreen title="Not found" text="It is gone." action={<a href="/x">Back</a>} />);
    expect(html).toMatch(/<h1[^>]*>Not found<\/h1>/);
    expect(html).toContain("It is gone.");
    expect(html).toContain('<a href="/x">Back</a>');
  });
});

describe("ErrorScreen", () => {
  it("shows the digest as a reference and a retry button", () => {
    const html = renderToStaticMarkup(<ErrorScreen digest="abc" onRetry={() => {}} homeHref="/" />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Reference: abc");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).toContain('href="/"');
  });

  it("omits the reference without a digest", () => {
    const html = renderToStaticMarkup(<ErrorScreen onRetry={() => {}} homeHref="/" />);
    expect(html).not.toContain("Reference");
  });
});
