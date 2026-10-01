import { describe, expect, it } from "vitest";
import { resolveLocale, resolveTimeZone } from "./locale";

describe("resolveLocale", () => {
  it("uses a supported preference", () => expect(resolveLocale("de", null)).toBe("de"));
  it("lets the preference win over the header", () => expect(resolveLocale("en", "de-DE,de;q=0.9")).toBe("en"));
  it("falls back to the header", () => expect(resolveLocale(undefined, "de-DE,de;q=0.9,en;q=0.8")).toBe("de"));
  it("respects q-values", () => expect(resolveLocale(undefined, "en;q=0.1, de;q=0.9")).toBe("de"));
  it("ignores unsupported languages", () => expect(resolveLocale(undefined, "fr-FR,fr")).toBe("en"));
  it("ignores an unsupported preference", () => expect(resolveLocale("fr", "de")).toBe("de"));
  it("never throws on garbage", () => {
    expect(resolveLocale(42, "!!!garbage")).toBe("en");
    expect(resolveLocale(undefined, ";q=,,;;q=x, de;q=abc")).toBe("de");
  });
  it("defaults to English", () => expect(resolveLocale(undefined, null)).toBe("en"));
});

describe("resolveTimeZone", () => {
  it("keeps a known zone", () => expect(resolveTimeZone("Europe/Berlin")).toBe("Europe/Berlin"));
  it("keeps zones missing from supportedValuesOf", () => {
    expect(resolveTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(resolveTimeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
  });
  it("replaces an unknown zone", () => expect(resolveTimeZone("Mars/Base")).toBe("UTC"));
  it("defaults to UTC", () => {
    expect(resolveTimeZone(undefined)).toBe("UTC");
    expect(resolveTimeZone(5)).toBe("UTC");
  });
});
