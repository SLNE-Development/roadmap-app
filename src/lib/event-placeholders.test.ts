import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED, fillPlaceholders, PLACEHOLDERS, placeholderValues, validateTemplate } from "./event-placeholders";

describe("fillPlaceholders", () => {
  it("fills the known placeholders", () => {
    expect(fillPlaceholders("{event} am {date} um {time}", { event: "Fest", start_date: "Samstag", start_time: "20:00 Uhr" })).toBe("Fest am Samstag um 20:00 Uhr");
  });

  it("leaves unknown names as written", () => {
    expect(fillPlaceholders("Hallo {foo} und {event}", { event: "Fest" })).toBe("Hallo {foo} und Fest");
  });

  it("collapses the gap an empty value leaves", () => {
    expect(fillPlaceholders("Ort: {where} – Infos", { where: "" })).toBe("Ort: – Infos");
    expect(fillPlaceholders("Ort: {where}", {})).toBe("Ort:");
    expect(fillPlaceholders("A\nOrt: {where}\nB", { where: "" })).toBe("A\nOrt:\nB");
  });

  it("never expands a value again", () => {
    expect(fillPlaceholders("{where}", { where: "{event}", event: "Fest" })).toBe("{event}");
  });

  it("does not treat double braces as an escape", () => {
    expect(fillPlaceholders("{{event}}", { event: "Fest" })).toBe("{{event}}");
  });

  it("resolves the aliases before the allow check", () => {
    expect(fillPlaceholders("{date} {time}", { start_date: "A", start_time: "B" })).toBe("A B");
    expect(fillPlaceholders("{date}", { start_date: "A" }, { allow: ["event"] })).toBe("{date}");
  });

  it("picks the values of the mode", () => {
    const values = { discord: { start_date: "<t:1:D>" }, text: { start_date: "1. Januar" } };
    expect(fillPlaceholders("{start_date}", values)).toBe("<t:1:D>");
    expect(fillPlaceholders("{start_date}", values, { mode: "text" })).toBe("1. Januar");
  });

  it("keeps {note} unless it is allowed", () => {
    expect(fillPlaceholders("Stand: {note}", { note: "ok" })).toBe("Stand: {note}");
    expect(fillPlaceholders("Stand: {note}", { note: "ok" }, { allow: PLACEHOLDERS })).toBe("Stand: ok");
  });
});

describe("validateTemplate", () => {
  it("returns the unknown and the not allowed names once", () => {
    expect(validateTemplate("{event} {foo} {foo} {note}", PLACEHOLDERS.filter((p) => p !== "note"))).toEqual(["foo", "note"]);
    expect(validateTemplate("{event} {{event}}", PLACEHOLDERS)).toEqual([]);
    expect(validateTemplate("{date} {foo}", DEFAULT_ALLOWED)).toEqual(["foo"]);
  });
});

describe("placeholderValues", () => {
  const settings = { timeZone: "Europe/Berlin", rulebookUrl: "https://example.com/rules" };
  const request = { title: "Piratenfest", startsAt: new Date("2026-10-17T18:00:00Z"), durationMinutes: 90, where: "Hafenwelt", eventDocsUrl: "https://example.com/docs" };
  const S = 1792260000;

  it("gives discord timestamps in discord mode", () => {
    const v = placeholderValues(request, settings).discord;
    expect(v).toMatchObject({ start: `<t:${S}:F>`, start_date: `<t:${S}:D>`, start_time: `<t:${S}:t>`, end_date: `<t:${S + 5400}:D>`, end_time: `<t:${S + 5400}:t>`, countdown: `<t:${S}:R>` });
  });

  it("formats date and time in the settings zone in text mode", () => {
    const v = placeholderValues(request, settings).text;
    expect(v.start).toBe("Samstag, 17. Oktober 2026 um 20:00 Uhr");
    expect(v.start_date).toBe("17. Oktober 2026");
    expect(v.start_time).toBe("20:00 Uhr");
    expect(v.end_time).toBe("21:30 Uhr");
    expect(v.countdown).toBe("");
    expect(v).toMatchObject({ event: "Piratenfest", where: "Hafenwelt", docs: "https://example.com/docs", rules: "https://example.com/rules", note: "" });
  });

  it("adds the duration to the start for the end", () => {
    const v = placeholderValues({ ...request, startsAt: new Date("2026-10-03T18:00:00Z"), durationMinutes: 120 }, settings).text;
    expect(v.end_time).toBe("22:00 Uhr");
    expect(fillPlaceholders("Ende {end_time} Uhr", placeholderValues({ ...request, durationMinutes: null }, settings), { mode: "text" })).toBe("Ende Uhr");
  });

  it("formats the duration in German", () => {
    const d = (m: number) => placeholderValues({ ...request, durationMinutes: m }, settings).text.duration;
    expect([d(45), d(60), d(90), d(120)]).toEqual(["45 Minuten", "1 Stunde", "1 Stunde 30 Minuten", "2 Stunden"]);
  });

  it("fills {date} like {start_date} in both modes", () => {
    const values = placeholderValues(request, settings);
    for (const mode of ["discord", "text"] as const) expect(fillPlaceholders("{date}", values, { mode })).toBe(fillPlaceholders("{start_date}", values, { mode }));
  });

  it("gives empty strings for missing data and carries the note", () => {
    const v = placeholderValues({ title: "X", startsAt: null, durationMinutes: null, where: "", eventDocsUrl: null }, { timeZone: "UTC", rulebookUrl: null }, "Alles gut");
    const empty = { event: "X", start: "", start_date: "", start_time: "", end_date: "", end_time: "", countdown: "", duration: "", docs: "", rules: "", where: "", note: "Alles gut" };
    expect(v.text).toEqual(empty);
    expect(v.discord).toEqual(empty);
  });
});
