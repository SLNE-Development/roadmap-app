import { describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";
import { insertUser } from "@/test/fixtures";
import { prefSchema } from "@/lib/pref-keys";
import { setPref } from "./prefs";
import { DEFAULT_NOTIFY_RULES, inQuietHours, notifyRulesSchema, pushDecision, quietEndsAt, readNotifyRules, wantsPush, type NotifyRules } from "./notify-rules";

const berlin: NotifyRules = { ...DEFAULT_NOTIFY_RULES, quiet: { enabled: true, start: "22:00", end: "08:00", timeZone: "Europe/Berlin" } };
const quietNight = new Date("2026-10-01T21:30:00Z");
const day = new Date("2026-10-01T07:30:00Z");

describe("readNotifyRules", () => {
  it("gives the defaults for an unset pref", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    expect(await readNotifyRules(db, a.userId)).toEqual(DEFAULT_NOTIFY_RULES);
  });

  it("merges a stored value over the defaults per kind", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await setPref(db, a, "notify.rules", { kinds: { mention: { inbox: true, push: false } } });
    const rules = await readNotifyRules(db, a.userId);
    expect(rules.kinds.mention.push).toBe(false);
    expect(rules.kinds["question.asked"].push).toBe(true);
    expect(rules.quiet).toEqual(DEFAULT_NOTIFY_RULES.quiet);
  });

  it("falls back to the defaults for junk", async () => {
    const db = await createTestDb();
    const a = await insertUser(db);
    await setPref(db, a, "notify.rules", "x");
    expect(await readNotifyRules(db, a.userId)).toEqual(DEFAULT_NOTIFY_RULES);
  });
});

describe("notifyRulesSchema", () => {
  it("is the schema of the notify.rules pref and rejects a partial value", () => {
    const schema = prefSchema("notify.rules");
    expect(schema?.safeParse(DEFAULT_NOTIFY_RULES).success).toBe(true);
    expect(schema?.safeParse({ kinds: { mention: { inbox: true, push: false } } }).success).toBe(false);
  });

  it("accepts the defaults and rejects an unknown time zone", () => {
    expect(notifyRulesSchema.safeParse(DEFAULT_NOTIFY_RULES).success).toBe(true);
    expect(notifyRulesSchema.safeParse({ ...DEFAULT_NOTIFY_RULES, quiet: { ...DEFAULT_NOTIFY_RULES.quiet, timeZone: "Mars/Base" } }).success).toBe(false);
  });
});

describe("quiet hours", () => {
  it("works across midnight in the time zone of the rules", () => {
    expect(inQuietHours(berlin, quietNight)).toBe(true);
    expect(inQuietHours(berlin, day)).toBe(false);
    expect(inQuietHours(DEFAULT_NOTIFY_RULES, quietNight)).toBe(false);
  });

  it("ends at 08:00 Berlin the next day from 23:30", () => {
    expect(quietEndsAt(berlin, quietNight).toISOString()).toBe("2026-10-02T06:00:00.000Z");
  });

  it("ends at 08:00 Berlin the same day from 03:00", () => {
    expect(quietEndsAt(berlin, new Date("2026-10-01T01:00:00Z")).toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });

  it("ends at 08:00 CET after a night with the clocks going back", () => {
    expect(quietEndsAt(berlin, new Date("2026-10-24T21:30:00Z")).toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });

  it("is never quiet when start equals end", () => {
    const same: NotifyRules = { ...berlin, quiet: { ...berlin.quiet, start: "08:00", end: "08:00" } };
    expect(inQuietHours(same, quietNight)).toBe(false);
  });

  it("handles a window within one day", () => {
    const office: NotifyRules = { ...berlin, quiet: { ...berlin.quiet, start: "09:00", end: "17:00" } };
    expect(inQuietHours(office, day)).toBe(true);
    expect(inQuietHours(office, quietNight)).toBe(false);
  });
});

describe("pushDecision", () => {
  it("holds in quiet hours, skips while active and sends otherwise", () => {
    expect(pushDecision(berlin, "mention", quietNight, false)).toBe("later");
    expect(pushDecision(berlin, "mention", day, true)).toBe("skip");
    expect(pushDecision(berlin, "mention", day, false)).toBe("send");
  });

  it("skips a kind with push off", () => {
    expect(wantsPush(DEFAULT_NOTIFY_RULES, "update.posted")).toBe(false);
    expect(pushDecision(DEFAULT_NOTIFY_RULES, "update.posted", day, false)).toBe("skip");
  });
});
