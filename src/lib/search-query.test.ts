import { describe, expect, it } from "vitest";
import { toPrefixQuery } from "./search-query";

describe("toPrefixQuery", () => {
  it("turns words into lowercased prefix terms joined by &", () => expect(toPrefixQuery("Rebuild index")).toBe("rebuild:* & index:*"));
  it("drops single letters", () => expect(toPrefixQuery("a & !b")).toBe(null));
  it("strips tsquery syntax", () => expect(toPrefixQuery("foo:* <-> (bar)")).toBe("foo:* & bar:*"));
  it("returns null for punctuation only", () => expect(toPrefixQuery("'")).toBe(null));
  it("returns null for blank input", () => expect(toPrefixQuery("   ")).toBe(null));
  it("keeps letters outside ASCII", () => expect(toPrefixQuery("Übergabe")).toBe("übergabe:*"));
  it("keeps at most 8 words", () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    expect(toPrefixQuery(words)?.split(" & ")).toHaveLength(8);
  });
});
