import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "@/lib/ops/activity";
import { describeChange } from "./activity-feed";

const names = { tasks: new Map<string, string>(), domains: new Map<string, string>(), phases: new Map<string, string>() };
const entry = (oldValue: string | null, newValue: string | null) => ({ entity: "system", entityId: "s1", field: "release", oldValue, newValue }) as HistoryEntry;

describe("describeChange", () => {
  it("describes a system joining or leaving a release", () => {
    expect(describeChange(entry(null, "1.0"), names)).toBe("moved it to release 1.0");
    expect(describeChange(entry("1.0", null), names)).toBe("removed it from 1.0");
  });
});
