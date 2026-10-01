import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SystemListItem } from "@/lib/ops/systems";
import de from "../../messages/de";
import en from "../../messages/en";
import { SystemCard } from "./system-card";

const system: SystemListItem = {
  id: "s1",
  slug: "garages",
  title: "Garages",
  summary: "",
  priority: "Later",
  boardSlug: "build",
  boardName: "Build",
  columnId: "c1",
  columnName: "Active",
  columnCategory: "active",
  domainId: null,
  phaseId: null,
  releaseSlug: null,
  releaseName: null,
  ownerUserId: null,
  ownerName: null,
  planningComplete: true,
  planningAreasCovered: 4,
  planningRounds: 1,
  tasksTotal: 3,
  tasksDone: 1,
  tasksBlocked: 2,
  points: 0,
  pointsDone: 0,
  unestimated: 0,
  openQuestions: 0,
  dependsOn: ["a", "b"],
  blockedBy: ["a", "b"],
  fields: {},
  failingChecks: false,
  archivedAt: null,
};

const render = (locale: "en" | "de") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "de" ? de : en} timeZone="UTC">
      <SystemCard system={system} projectSlug="demo" />
    </NextIntlClientProvider>,
  );

describe("SystemCard", () => {
  it("reads in English", () => {
    const html = render("en");
    expect(html).toContain("Blocked by 2");
    expect(html).toContain("Later");
  });

  it("reads in German", () => {
    const html = render("de");
    expect(html).toContain("Blockiert durch 2");
    expect(html).toContain("Später");
    expect(html).toContain("2 blockierte Aufgaben");
  });
});
