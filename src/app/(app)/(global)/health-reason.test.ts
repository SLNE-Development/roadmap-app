import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../../../messages/de";
import en from "../../../../messages/en";
import { healthReasonText } from "./health-reason";

const t = (locale: "en" | "de") => createTranslator({ locale, messages: locale === "de" ? de : en, namespace: "home" });

describe("healthReasonText", () => {
  it("words every reason in German with plurals", () => {
    const tr = t("de");
    expect(healthReasonText(tr, { code: "allDone" })).toBe("Alles ist erledigt.");
    expect(healthReasonText(tr, { code: "noChanges", days: 1, limit: 14 })).toBe("Seit 1 Tag keine Änderungen.");
    expect(healthReasonText(tr, { code: "noChanges", days: 20, limit: 14 })).toBe("Seit 20 Tagen keine Änderungen.");
    expect(healthReasonText(tr, { code: "noChanges", days: null, limit: 14 })).toBe("Seit mehr als 14 Tagen keine Änderungen.");
    expect(healthReasonText(tr, { code: "quietProgress", stale: 2, total: 4 })).toBe("Ins Stocken geraten: 2 von 4 Systemen in Arbeit.");
    expect(healthReasonText(tr, { code: "blocked", blocked: 1, open: 3 })).toBe("Blockiert: 1 von 3 offenen Systemen.");
    expect(healthReasonText(tr, { code: "staleSystems", count: 2, days: 7 })).toBe("2 Systeme haben seit 7+ Tagen keine Aktualisierung.");
    expect(healthReasonText(tr, { code: "blockingQuestions", count: 1 })).toBe("1 blockierende Frage ist offen.");
  });

  it("words the reasons in English", () => {
    const tr = t("en");
    expect(healthReasonText(tr, { code: "noChanges", days: 14, limit: 14 })).toBe("No changes for 14 days.");
    expect(healthReasonText(tr, { code: "quietProgress", stale: 2, total: 4 })).toBe("Gone quiet: 2 of 4 systems in progress.");
    expect(healthReasonText(tr, { code: "blocked", blocked: 2, open: 10 })).toBe("Blocked: 2 of 10 open systems.");
    expect(healthReasonText(tr, { code: "quietProgress", stale: 1, total: 4 })).toBe("Gone quiet: 1 of 4 systems in progress.");
    expect(healthReasonText(tr, { code: "staleSystems", count: 1, days: 7 })).toBe("1 system has had no update for 7+ days.");
    expect(healthReasonText(tr, { code: "blockingQuestions", count: 3 })).toBe("3 blocking questions are open.");
  });
});
