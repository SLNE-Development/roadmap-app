import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../../messages/de";
import en from "../../../messages/en";
import { historySentence } from "./history-sentence";

const row = (field: string, oldValue: string | null, newValue: string | null, agent: string | null = null) => ({ field, oldValue, newValue, authorName: "Ammo", agent });
const english = createTranslator({ locale: "en", messages: en, namespace: "events" });
const german = createTranslator({ locale: "de", messages: de, namespace: "events" });
const say = (r: ReturnType<typeof row>, t = english) => historySentence(r, (key, values) => t(key as never, values as never));

describe("historySentence", () => {
  it("writes the posts the ops log with the kind's label", () => {
    expect(say(row("post", null, "announcement draft saved"))).toBe("Ammo saved the announcement draft");
    expect(say(row("post", "draft", "announcement sending"), german)).toBe("Ammo hat die Nachricht „Ankündigung“ gesendet");
    expect(say(row("post", "posted", "disaster deleting"))).toBe("Ammo deleted the disaster message");
    expect(say(row("post", null, "team draft written"))).toBe("Ammo wrote a team draft");
    expect(say(row("post", null, "reminder draft written"), german)).toBe("Ammo hat einen Entwurf für „Erinnerung“ geschrieben");
  });

  it("writes status changes, cancels and creation", () => {
    expect(say(row("status", "accepted", "event_week"))).toBe("Ammo changed the status from Accepted to Event week");
    expect(say(row("status", "accepted", "Venue closed"))).toBe("Ammo cancelled the event: Venue closed");
    expect(say(row("created", null, "Party"), german)).toBe("Ammo hat die Anfrage angelegt");
  });

  it("writes the checklist, to-dos, fallback, questions and project", () => {
    expect(say(row("checklist", null, "7 items"), german)).toBe("Ammo hat die Eventtag-Checkliste gesetzt (7 Punkte)");
    expect(say(row("todo", "Book DJ", "done"))).toBe("Ammo ticked off the to-do \"Book DJ\"");
    expect(say(row("fallback", null, "Power outage"))).toBe("Ammo changed the fallback scenario \"Power outage\"");
    expect(say(row("questions", null, "round 2 asked"))).toBe("Ammo asked round 2 of questions");
    expect(say(row("answer", null, "round 1, question 3: not sure"))).toBe("Ammo was not sure about question 3 of round 1");
    expect(say(row("project", null, "summer-party"))).toBe("Ammo linked the project summer-party");
  });

  it("labels changed fields and falls back for unknown ones, naming the agent", () => {
    expect(say(row("where", "A", "B"))).toBe("Ammo changed the place");
    expect(say(row("mystery", null, "x"))).toBe("Ammo changed the request");
    expect(say(row("post", null, "garbled"))).toBe("Ammo changed the request");
    expect(say(row("summary", "", "Text", "Claude"))).toBe("Ammo changed the short description (via Claude)");
  });
});
