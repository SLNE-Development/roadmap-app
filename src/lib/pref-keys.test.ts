import { describe, expect, it } from "vitest";
import { PREF_SCHEMAS, prefSchema } from "./pref-keys";

describe("prefSchema", () => {
  it("matches an exact key", () => {
    expect(prefSchema("overview.panels")).toBe(PREF_SCHEMAS["overview.panels"]);
    expect(prefSchema("mywork.seenAt")).toBe(PREF_SCHEMAS["mywork.seenAt"]);
  });

  it("matches a prefix followed by a dot", () => {
    expect(prefSchema("board.collapsed.abc")).toBe(PREF_SCHEMAS["board.collapsed"]);
  });

  it("returns null for unknown keys", () => {
    expect(prefSchema("nope")).toBeNull();
    expect(prefSchema("board.collapsedabc")).toBeNull();
    expect(prefSchema("board.collapsed")).toBe(PREF_SCHEMAS["board.collapsed"]);
  });

  it("validates values", () => {
    const schema = prefSchema("board.collapsed.abc");
    expect(schema?.safeParse({ columns: ["a"], lanes: ["domain:x"] }).success).toBe(true);
    expect(schema?.safeParse({ columns: "a" }).success).toBe(false);
    expect(prefSchema("mywork.seenAt")?.safeParse(new Date().toISOString()).success).toBe(true);
    expect(prefSchema("mywork.seenAt")?.safeParse("x").success).toBe(false);
  });
});
