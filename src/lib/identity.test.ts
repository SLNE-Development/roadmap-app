import { describe, expect, it } from "vitest";
import { identityColor, initials } from "./identity";

describe("initials", () => {
  it("takes first and last word", () => {
    expect(initials("Aiko Tanaka")).toBe("AT");
    expect(initials("Mara van der Berg")).toBe("MB");
  });

  it("takes two letters of a single word", () => {
    expect(initials("Ammo")).toBe("AM");
    expect(initials("surf-roleplay")).toBe("SR");
  });

  it("handles blank names", () => {
    expect(initials("  ")).toBe("?");
  });
});

describe("identityColor", () => {
  it("is stable for the same key", () => {
    expect(identityColor("Aiko Tanaka")).toBe(identityColor("Aiko Tanaka"));
  });

  it("returns a palette colour", () => {
    expect(identityColor("x")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
