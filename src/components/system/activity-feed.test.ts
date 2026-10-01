import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/lib/ops/activity";
import de from "../../../messages/de";
import en from "../../../messages/en";
import { describeChange } from "./activity-feed";

const names = { tasks: new Map<string, string>(), domains: new Map<string, string>(), phases: new Map<string, string>() };
const entry = (oldValue: string | null, newValue: string | null, field = "release", entity = "system") => ({ entity, entityId: "s1", field, oldValue, newValue }) as HistoryEntry;
const describeIn = (locale: "en" | "de", e: HistoryEntry) => {
  const messages = locale === "de" ? de : en;
  return describeChange(e, names, createTranslator({ locale, messages, namespace: "system" }), createTranslator({ locale, messages, namespace: "enums" }));
};

describe("describeChange", () => {
  it("describes a system joining or leaving a release", () => {
    expect(describeIn("en", entry(null, "1.0"))).toBe("moved it to release 1.0");
    expect(describeIn("en", entry("1.0", null))).toBe("removed it from 1.0");
  });

  it("translates stored priorities and plural counts", () => {
    expect(describeIn("en", entry("MVP", "Nice to have", "priority"))).toBe("changed the priority from MVP to Nice to have");
    expect(describeIn("de", entry("Nice to have", "Later", "priority"))).toBe("hat die Priorität von Optional auf Später geändert");
    expect(describeIn("en", entry(null, "round 2: 1 questions", "round", "planning"))).toBe("asked planning round 2 (1 question)");
    expect(describeIn("de", entry(null, "round 2: 3 questions", "round", "planning"))).toBe("hat Planungsrunde 2 gestartet (3 Fragen)");
  });
});
