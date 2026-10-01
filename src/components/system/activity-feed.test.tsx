import { createFormatter, NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClockProvider } from "@/components/clock";
import type { HistoryEntry } from "@/lib/ops/activity";
import type { UpdateItem } from "@/lib/ops/updates";
import de from "../../../messages/de";
import { ActivityFeed } from "./activity-feed";

const fixed = Date.parse("2026-10-01T12:00:00.000Z");
const fiveMinutesAgo = new Date(fixed - 5 * 60_000);
const update = { id: "u1", systemSlug: "auth", systemTitle: "Auth", taskId: null, taskTitle: null, summary: "Erste Fassung", nextStep: null, commitHash: null, commitUrl: null, isAgent: false, authorName: "Aiko", agent: null, createdAt: fiveMinutesAgo } as UpdateItem;
const change = { id: 7, entity: "system", entityId: "s1", systemId: "s1", field: "summary", oldValue: null, newValue: null, authorName: "Aiko", agent: null, createdAt: new Date(fixed - 2 * 3_600_000) } as HistoryEntry;
const names = { tasks: new Map<string, string>(), domains: new Map<string, string>(), phases: new Map<string, string>() };

/** Renders the feed as the server does: German, Berlin time, and the clock fixed at `fixed`. */
const render = () =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="de" messages={de} timeZone="Europe/Berlin" now={new Date(fixed)}>
      <ClockProvider serverNow={fixed}>
        <ActivityFeed updates={[update]} changes={[change]} names={names} base="/p/demo/systems/auth" />
      </ClockProvider>
    </NextIntlClientProvider>,
  );

describe("ActivityFeed", () => {
  it("shows the age in the user's language and the time of day in their time zone", () => {
    const format = createFormatter({ locale: "de", timeZone: "Europe/Berlin", now: new Date(fixed) });
    const html = render();
    expect(format.relativeTime(fiveMinutesAgo, new Date(fixed))).toBe("vor 5 Minuten");
    expect(html).toContain('title="vor 5 Minuten"');
    expect(html).toContain("13:55");
    expect(html).toContain("Heute");
    expect(html).toContain("hat die Zusammenfassung bearbeitet");
  });

  it("renders the same markup for the same inputs", () => {
    expect(render()).toBe(render());
  });
});
