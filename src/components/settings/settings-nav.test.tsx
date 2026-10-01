import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import de from "../../../messages/de";
import { SettingsNav } from "./settings-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/p/demo/settings" }));

describe("SettingsNav", () => {
  it("renders the German labels, and Notifications only for owners", () => {
    const render = (canOwn: boolean) =>
      renderToStaticMarkup(
        <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
          <SettingsNav projectSlug="demo" memberCount={3} boardCount={2} repoCount={null} fieldCount={1} canOwn={canOwn} />
        </NextIntlClientProvider>,
      );
    const owner = render(true);
    expect(owner).toContain("Allgemein");
    expect(owner).toContain("Mitglieder");
    expect(owner).toContain("Benachrichtigungen");
    expect(render(false)).not.toContain("Benachrichtigungen");
  });
});
