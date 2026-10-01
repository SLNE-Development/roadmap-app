import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AttentionItem } from "@/lib/ops/attention";
import de from "../../../messages/de";
import { AttentionList } from "./attention-list";

const base = { href: "/p/x", at: null, systemId: null, detail: "", title: "" };

/** Renders the items as German text. */
function renderDe(items: AttentionItem[]): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={de} timeZone="UTC">
      <AttentionList items={items} />
    </NextIntlClientProvider>,
  );
}

describe("AttentionList", () => {
  it("labels the kind of an item in German", () => {
    const html = renderDe([{ ...base, key: "d1", kind: "decision", title: "ADR-0003 is waiting for acceptance", detail: "Cache", params: { kind: "decision", number: "0003", title: "Cache" } }]);
    expect(html).toContain("Entscheidung");
    expect(html).toContain("ADR-0003 wartet auf Annahme");
    expect(html).toContain("Cache");
  });

  it("writes titles and details from the params in German", () => {
    const html = renderDe([
      { ...base, key: "s", kind: "stale", params: { kind: "stale", system: "Alpha", days: 1 } },
      { ...base, key: "p", kind: "planning", params: { kind: "planning", system: "Beta", areas: ["scope", "dependencies"], open: 2, noSpec: true } },
      { ...base, key: "q", kind: "question", title: "Wer ist verantwortlich?", params: { kind: "question", blocking: true, author: "Aiko", answered: false } },
    ]);
    expect(html).toContain("Alpha hat seit 1 Tag keine Fortschrittsmeldung");
    expect(html).toContain("Umfang und Abhängigkeiten haben noch keine Antwort; 2 Einträge sind noch offen; es ist keine Spezifikation geschrieben.");
    expect(html).toContain("Wer ist verantwortlich?");
    expect(html).toContain("Blockierend · Gefragt von Aiko, noch keine Antwort.");
  });
});
