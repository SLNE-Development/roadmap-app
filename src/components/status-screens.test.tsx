import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import de from "../../messages/de";
import en from "../../messages/en";
import { ErrorScreen, NotFoundScreen } from "./status-screens";

const render = (node: React.ReactNode, locale: "en" | "de" = "en") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );

describe("NotFoundScreen", () => {
  it("renders the title as the page heading, the text and the action", () => {
    const html = render(<NotFoundScreen title="Not found" text="It is gone." action={<a href="/x">Back</a>} />);
    expect(html).toMatch(/<h1[^>]*>Not found<\/h1>/);
    expect(html).toContain("It is gone.");
    expect(html).toContain('<a href="/x">Back</a>');
  });
});

describe("ErrorScreen", () => {
  it("shows the digest as a reference and a retry button", () => {
    const html = render(<ErrorScreen digest="abc" onRetry={() => {}} homeHref="/" />);
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Reference: abc");
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/);
    expect(html).toContain('href="/"');
  });

  it("omits the reference without a digest", () => {
    const html = render(<ErrorScreen onRetry={() => {}} homeHref="/" />);
    expect(html).not.toContain("Reference");
  });

  it("speaks German", () => {
    const html = render(<ErrorScreen digest="abc" onRetry={() => {}} homeHref="/" />, "de");
    expect(html).toContain("Etwas ist schiefgelaufen");
    expect(html).toContain("Referenz: abc");
    expect(html).toMatch(/<button[^>]*>Erneut versuchen<\/button>/);
  });
});
