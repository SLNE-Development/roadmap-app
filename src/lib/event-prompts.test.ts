import { describe, expect, it } from "vitest";
import { buildPrompts, describeAnswer, PLACEHOLDER_GUIDE, type PromptInput } from "./event-prompts";
import { DEFAULT_STYLE_GUIDES } from "./event-templates";

const input: PromptInput = {
  request: { title: "Piratenfest", startsAt: new Date("2026-10-17T18:00:00Z"), durationMinutes: 90, where: "Hafenwelt", eventDocsUrl: "https://example.com/infos" },
  settings: {
    timeZone: "Europe/Berlin",
    rulebookUrl: "https://example.com/regeln",
    announcementStyle: "STYLE-ANN locker und warm",
    announcementExample: "EXAMPLE-ANN Hallo zusammen",
    reminderExample: "EXAMPLE-REM Gleich geht es los",
    teamStyle: "STYLE-TEAM knapp",
    teamExample: "EXAMPLE-TEAM Team, bitte lesen",
  },
  brief: "BRIEF-TEXT Ein Fest am Hafen. Mit Musik.",
  answers: [
    { question: "Gibt es Preise?", answer: "Ja" },
    { question: "Wie viele Spieler?", answer: "40 Spieler" },
    { question: "Moderation: Wie viele Mods?", answer: "3 Mods" },
  ],
  fallback: [{ title: "Server fällt aus", whatWeDo: "WHATWEDO-TEXT Neustart", whoDecides: "WHODECIDES-TEXT Anna" }],
  moderation: [{ question: "Moderation: Wie viele Mods?", answer: "3 Mods" }],
};

describe("buildPrompts", () => {
  const p = buildPrompts(input);

  it("fills the announcement with style, example, facts, answers and links", () => {
    for (const text of ["STYLE-ANN", "EXAMPLE-ANN", "Piratenfest", "17. Oktober 2026", "20:00 Uhr", "Hafenwelt", "BRIEF-TEXT", "https://example.com/infos", "https://example.com/regeln"]) {
      expect(p.announcement).toContain(text);
    }
    expect(p.announcement).toContain("Gibt es Preise?: Ja");
    expect(p.announcement).toContain("Wie viele Spieler?: 40 Spieler");
    expect(p.announcement).toContain("Beginne mit `# <Eventname>`");
    expect(p.announcement).toContain("Nicht in der Ankündigung nennen, nur zur Information");
    expect(p.announcement).toContain("Server fällt aus");
    expect(p.announcement).not.toContain("WHATWEDO-TEXT");
  });

  it("gives the team the full fallback plan and the moderation block", () => {
    expect(p.team).toContain("STYLE-TEAM");
    expect(p.team).toContain("EXAMPLE-TEAM");
    expect(p.team).toContain("WHATWEDO-TEXT");
    expect(p.team).toContain("WHODECIDES-TEXT");
    expect(p.team).toContain("Moderation: Wie viele Mods?: 3 Mods");
  });

  it("keeps the reminder short and free of the fallback", () => {
    expect(p.reminder.length).toBeLessThan(p.announcement.length);
    expect(p.reminder).toContain("EXAMPLE-REM");
    expect(p.reminder).toContain("20:00 Uhr");
    expect(p.reminder).not.toContain("Server fällt aus");
  });

  it("tells every prompt but the summary to write placeholders", () => {
    for (const kind of ["announcement", "reminder", "team"] as const) {
      expect(p[kind]).toContain(PLACEHOLDER_GUIDE);
      expect(p[kind]).toContain("Zur Orientierung (nicht abschreiben)");
    }
    for (const text of Object.values(p)) expect(text).not.toContain("Schreibe das Datum");
  });

  it("asks the summary prompt for a short text without placeholders", () => {
    expect(p.summary).toContain("höchstens 300 Zeichen");
    expect(p.summary).not.toContain(PLACEHOLDER_GUIDE);
    expect(p.summary).toContain("BRIEF-TEXT");
    expect(p.summary).toContain("Piratenfest");
  });

  it("stays generic", () => {
    const empty = buildPrompts({ ...input, settings: { ...input.settings, announcementStyle: "", teamStyle: "" } });
    for (const text of [...Object.values(p), ...Object.values(empty)]) expect(text).not.toMatch(/claude|anthropic|chatgpt|openai|gpt|roadmap|surf/i);
  });

  it("uses the default style when the settings are empty", () => {
    const empty = buildPrompts({ ...input, settings: { ...input.settings, announcementStyle: "", teamStyle: "" } });
    expect(empty.announcement).toContain(DEFAULT_STYLE_GUIDES.announcement);
    expect(empty.team).toContain(DEFAULT_STYLE_GUIDES.team);
  });

  it("omits missing data together with its label", () => {
    const sparse = buildPrompts({ ...input, request: { ...input.request, eventDocsUrl: null }, settings: { ...input.settings, rulebookUrl: null }, moderation: [], answers: [] });
    for (const text of Object.values(sparse)) {
      expect(text).not.toMatch(/undefined|null/);
      expect(text).not.toContain("Infos zum Event");
      expect(text).not.toContain("Regeln:");
    }
    expect(sparse.team).not.toContain("Moderation (");
  });
});

describe("describeAnswer", () => {
  it("renders every type as readable German", () => {
    expect(describeAnswer({ type: "yesno", answer: true, notSure: false })).toBe("Ja");
    expect(describeAnswer({ type: "yesno", answer: false, notSure: false })).toBe("Nein");
    expect(describeAnswer({ type: "multi", answer: { options: ["A", "B"], other: "x" }, notSure: false })).toBe("A, B, Sonstiges: x");
    expect(describeAnswer({ type: "scale", answer: 3, max: 5, notSure: false })).toBe("3 von 5");
    expect(describeAnswer({ type: "number", answer: 40, unit: "Spieler", notSure: false })).toBe("40 Spieler");
    expect(describeAnswer({ type: "date", answer: "2026-10-17", notSure: false })).toBe("Samstag, 17. Oktober 2026");
    expect(describeAnswer({ type: "time", answer: "20:00", notSure: false })).toBe("20:00 Uhr");
    expect(describeAnswer({ type: "choice", answer: { option: "Nord" }, notSure: false })).toBe("Nord");
    expect(describeAnswer({ type: "text", answer: null, notSure: true })).toBe("Offen, das Team entscheidet");
  });
});
