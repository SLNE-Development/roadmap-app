import { describe, expect, it } from "vitest";
import en from "../../messages/en";
import { actorValues, renderNotificationText, type NotificationTextKey } from "./notification-text";

const KEYS = Object.keys(en.notifications.text) as NotificationTextKey[];
const VALUES = { actor: "Jules", system: "Auth", number: 7, title: "Login" };

describe("renderNotificationText", () => {
  it("renders every key in both languages with all values filled in", () => {
    for (const locale of ["en", "de"]) {
      for (const key of KEYS) {
        const text = renderNotificationText(locale, { key, values: VALUES });
        expect(text, `${locale} ${key}`).not.toMatch(/[{}]/);
        expect(text.length).toBeGreaterThan(0);
      }
    }
  });

  it("renders German for the de preference and English for anything else", () => {
    const text = { key: "mentionTask", values: VALUES } as const;
    expect(renderNotificationText("de", text)).toBe("Jules hat dich bei Aufgabe #7 erwähnt");
    expect(renderNotificationText(null, text)).toBe("Jules mentioned you on task #7");
    expect(renderNotificationText("fr", text)).toBe("Jules mentioned you on task #7");
  });

  it("names a missing actor in the recipient's language", () => {
    const text = { key: "mentionTask", values: { ...actorValues(null, null), number: 7 } } as const;
    expect(renderNotificationText("de", text)).toBe("Jemand hat dich bei Aufgabe #7 erwähnt");
    expect(renderNotificationText("en", text)).toBe("Someone mentioned you on task #7");
  });
});
