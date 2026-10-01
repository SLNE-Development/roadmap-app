import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup as render } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import en from "../../../messages/en";
import { BurnupChart } from "./burnup-chart";

/** Renders `ui` as English text inside the intl provider the chart needs. */
function renderToStaticMarkup(ui: ReactElement): string {
  return render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

const points = [
  { day: "2026-09-29", scope: 10, done: 2 },
  { day: "2026-09-30", scope: 10, done: 3 },
  { day: "2026-10-01", scope: 10, done: 4 },
];

describe("BurnupChart", () => {
  it("draws the done line from the left margin", () => {
    const html = renderToStaticMarkup(<BurnupChart points={points} projection={{ status: "none", reason: "no-pace" }} />);
    const paths = [...html.matchAll(/<path[^>]*class="[^"]*stroke-primary[^"]*"[^>]*>/g)].map((m) => m[0]);
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/ d="M34 /);
    expect(html).not.toContain("<polygon");
  });

  it("labels the y axis with nice ticks", () => {
    const html = renderToStaticMarkup(<BurnupChart points={points} projection={{ status: "none", reason: "no-pace" }} />);
    const labels = [...html.matchAll(/<text[^>]*text-anchor="end"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).filter((l) => /^[0-9]+$/.test(l));
    expect(labels).toEqual(["0", "5", "10"]);
  });

  it("gives keyboard users a table and screen readers a summary", () => {
    const html = renderToStaticMarkup(<BurnupChart points={points} projection={{ status: "none", reason: "no-pace" }} />);
    expect(html).toContain('<table class="sr-only">');
    expect(html.match(/<tbody>.*<\/tbody>/)![0].match(/<tr>/g)).toHaveLength(3);
    expect(html).toMatch(/role="img"[^>]*aria-label="[^"]*done 4 of 10/);
  });

  it("draws the projection range as a polygon", () => {
    const html = renderToStaticMarkup(
      <BurnupChart
        points={points}
        projection={{ status: "range", paceLow: 1, paceHigh: 2, earliest: "2026-10-04", latest: "2026-10-08" }}
      />,
    );
    expect(html).toMatch(/<polygon[^>]*class="[^"]*fill-primary\/15/);
  });

  it("clips a slow projection at the right edge and labels where it ends", () => {
    const html = renderToStaticMarkup(
      <BurnupChart
        points={points}
        projection={{ status: "range", paceLow: 0.01, paceHigh: 0.02, earliest: "2026-12-01", latest: "2027-03-01" }}
      />,
    );
    const polygon = html.match(/<polygon points="([^"]*)"/)![1];
    const xs = polygon.split(" ").map((p) => Number(p.split(",")[0]));
    expect(Math.max(...xs)).toBeLessThanOrEqual(546);
    expect(html).toContain("→ Mar 1");
    // the history keeps most of the width: its last day sits well left of the edge
    expect(Number(html.match(/<line x1="([0-9.]+)"[^>]*stroke-dasharray="3 3"/)![1])).toBeLessThan(120);
  });
});
