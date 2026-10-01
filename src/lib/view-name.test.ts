import { describe, expect, it } from "vitest";
import { activeChips, suggestViewName } from "./view-name";

describe("suggestViewName", () => {
  it("joins the page and the filters", () => {
    expect(suggestViewName("Board", ["Owner: Ammo", "Priority: high"])).toBe("Board · Owner: Ammo · Priority: high");
  });

  it("is the page name alone without filters", () => {
    expect(suggestViewName("Systems", [])).toBe("Systems");
  });

  it("stays within the 60 character limit", () => {
    expect(suggestViewName("Board", ["x".repeat(100)])).toHaveLength(60);
  });
});

describe("activeChips", () => {
  const defs = [
    { key: "owner", label: "Owner", options: [{ value: "u1", label: "Ammo" }] },
    { key: "priority", label: "Priority", options: [{ value: "high", label: "high" }] },
  ];

  it("lists the search, then each set filter by its option label", () => {
    expect(activeChips(defs, { q: "auth", priority: "high", owner: "u1" })).toEqual(["Search: auth", "Owner: Ammo", "Priority: high"]);
  });

  it("shows an unknown value as is and skips unset filters", () => {
    expect(activeChips(defs, { owner: "gone" })).toEqual(["Owner: gone"]);
  });
});
