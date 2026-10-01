import { describe, expect, it } from "vitest";
import { playerMessageTexts } from "./event-day-panel";

const view = {
  request: { id: "r", title: "Server Night", startsAt: new Date("2026-11-07T19:00:00Z"), durationMinutes: 120, where: "Discord", status: "event_week" },
  timeZone: "Europe/Berlin",
  eventDocsUrl: "https://docs.example/event",
  rulebookUrl: "https://rules.example/book",
};

describe("playerMessageTexts", () => {
  const message = "Wir starten {start_date} um {start_time}. Doku {docs}, Regeln {rules}.";

  it("shows readable German date and time with docs and rules filled", () => {
    const { shown } = playerMessageTexts(message, view);
    expect(shown).toBe("Wir starten 7. November 2026 um 20:00 Uhr. Doku https://docs.example/event, Regeln https://rules.example/book.");
    expect(shown).not.toContain("<t:");
  });

  it("copies Discord timestamps with docs and rules filled", () => {
    const { copy } = playerMessageTexts(message, view);
    expect(copy).toMatch(/Wir starten <t:\d+:D> um <t:\d+:t>\./);
    expect(copy).toContain("Doku https://docs.example/event, Regeln https://rules.example/book.");
  });
});
