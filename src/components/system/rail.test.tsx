import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanningView } from "@/lib/ops/planning";
import de from "../../../messages/de";
import en from "../../../messages/en";
import { PlanningPanel } from "./rail";
import { useGapText } from "./text";

const planning = {
  completedAt: null,
  confirmation: null,
  rounds: [{ items: [{ status: "answered" }, { status: "accepted-risk" }, { status: "open" }] }],
  gaps: ["Area scope has no answered item.", "Area ops-testing has no answered item.", 'Item q1 is still open: "Which queue?".', "No spec has been written."],
} as unknown as PlanningView;

const render = (node: React.ReactNode, locale: "en" | "de") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="UTC">
      {node}
    </NextIntlClientProvider>,
  );

function Sentence({ gaps }: { gaps: string[] }) {
  return <p>{useGapText().stillInPlanning(gaps)}</p>;
}

describe("PlanningPanel", () => {
  it("reads in German with plurals and translated gaps", () => {
    const html = render(<PlanningPanel planning={planning} href="/x" />, "de");
    expect(html).toContain("In Planung");
    expect(html).toContain("1 Runde · 1 Antwort · 1 akzeptiertes Risiko");
    expect(html).toContain("Noch keine Antwort zu Umfang");
    expect(html).toContain("Offene Frage: Which queue?");
  });
});

describe("useGapText", () => {
  it("joins the gaps into one sentence per language", () => {
    expect(render(<Sentence gaps={planning.gaps} />, "en")).toContain("Still in planning: scope and ops and testing have no answer yet; 1 question is still open; no spec has been written.");
    expect(render(<Sentence gaps={planning.gaps} />, "de")).toContain("Noch in Planung: Umfang und Betrieb und Tests haben noch keine Antwort; 1 Frage ist noch offen; es wurde noch keine Spezifikation geschrieben.");
  });
});
