import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import de from "../../../messages/de";
import en from "../../../messages/en";
import { RejectedAccount } from "./rejected-account";

const ID = "123456789012345678";
const render = (locale: "en" | "de", discordId: string | null) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="UTC">
      <RejectedAccount discordId={discordId} />
    </NextIntlClientProvider>,
  );

describe("RejectedAccount", () => {
  it("shows the Discord id, the instruction and a Copy button", () => {
    const html = render("en", ID);
    expect(html).toContain(ID);
    expect(html).toContain("Send this ID to an admin to get access.");
    expect(html).toContain(">Copy<");
  });

  it("is in German too", () => {
    expect(render("de", ID)).toContain("Schick diese ID an einen Admin");
  });

  it("never puts the id into a link", () => {
    const hrefs = [...render("en", ID).matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.some((h) => h.includes(ID))).toBe(false);
  });

  it("renders nothing for an accepted account", () => {
    expect(render("en", null)).toBe("");
  });
});
