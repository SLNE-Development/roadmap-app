import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planningCoverage } from "@/lib/planning-coverage";
import de from "../../../messages/de";
import { CoverageMap } from "./coverage-map";

describe("CoverageMap", () => {
  it("words the thin reasons in German from the counts, not the English reason", () => {
    const coverage = planningCoverage([
      { area: "scope", status: "answered", isRisk: false },
      { area: "dependencies", status: "answered", isRisk: false },
      { area: "dependencies", status: "accepted-risk", isRisk: false },
    ]);
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="de" messages={de}>
        <CoverageMap coverage={coverage} />
      </NextIntlClientProvider>,
    );
    expect(html).toContain("Dünn: Noch keine Fragen gestellt.");
    expect(html).toContain("Dünn: Erst 1 geklärte Frage; stelle mindestens 2.");
    expect(html).not.toContain("No questions");
    expect(html).not.toContain("settled question");
  });
});
