import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_NOTIFY_RULES } from "@/lib/notify-rules-schema";
import de from "../../../messages/de";
import { RulesTable } from "./rules-table";

describe("RulesTable", () => {
  it("renders the settings rows in German", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
        <RulesTable kinds={DEFAULT_NOTIFY_RULES.kinds} pushEnabled onChange={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Benachrichtige mich, wenn");
    expect(html).toContain("meine Frage beantwortet wird");
    expect(html).toContain("meine Frage beantwortet wird: Posteingang");
  });
});
