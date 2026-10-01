import { describe, expect, it } from "vitest";
import { fillPlaceholders, PLACEHOLDERS, placeholderValues, validateTemplate } from "./event-placeholders";

describe("fillPlaceholders", () => {
  it("fills the known placeholders", () => {
    expect(fillPlaceholders("{event} am {date} um {time}", { event: "Fest", date: "Samstag", time: "20:00 Uhr" })).toBe("Fest am Samstag um 20:00 Uhr");
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

  it("keeps {note} unless it is allowed", () => {
    expect(fillPlaceholders("Stand: {note}", { note: "ok" })).toBe("Stand: {note}");
    expect(fillPlaceholders("Stand: {note}", { note: "ok" }, { allow: PLACEHOLDERS })).toBe("Stand: ok");
  });
});

describe("validateTemplate", () => {
  it("returns the unknown and the not allowed names once", () => {
    expect(validateTemplate("{event} {foo} {foo} {note}", PLACEHOLDERS.filter((p) => p !== "note"))).toEqual(["foo", "note"]);
    expect(validateTemplate("{event} {{event}}", PLACEHOLDERS)).toEqual([]);
  });
});

describe("placeholderValues", () => {
  const settings = { timeZone: "Europe/Berlin", rulebookUrl: "https://example.com/rules" };
  const request = { title: "Piratenfest", startsAt: new Date("2026-10-17T18:00:00Z"), durationMinutes: 90, where: "Hafenwelt", eventDocsUrl: "https://example.com/docs" };

  it("formats date and time in the settings zone", () => {
    const v = placeholderValues(request, settings);
    expect(v.date).toBe("Samstag, 17. Oktober 2026");
    expect(v.time).toBe("20:00 Uhr");
    expect(v).toMatchObject({ event: "Piratenfest", where: "Hafenwelt", docs: "https://example.com/docs", rules: "https://example.com/rules", note: "" });
  });

  it("formats the duration in German", () => {
    const d = (m: number) => placeholderValues({ ...request, durationMinutes: m }, settings).duration;
    expect([d(45), d(60), d(90), d(120)]).toEqual(["45 Minuten", "1 Stunde", "1 Stunde 30 Minuten", "2 Stunden"]);
  });

  it("gives empty strings for missing data and carries the note", () => {
    const v = placeholderValues({ title: "X", startsAt: null, durationMinutes: null, where: "", eventDocsUrl: null }, { timeZone: "UTC", rulebookUrl: null }, undefined, "Alles gut");
    expect(v).toEqual({ event: "X", date: "", time: "", duration: "", docs: "", rules: "", where: "", note: "Alles gut" });
  });
});
