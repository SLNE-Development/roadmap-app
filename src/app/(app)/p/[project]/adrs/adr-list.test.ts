import { describe, expect, it } from "vitest";
import { adrMatches } from "./adr-list";

const row = { title: "Use SSE", label: "0003", number: 3 };

describe("adrMatches", () => {
  it.each(["sse", "0003", "3", "ADR-3", "adr0003", "  SSE "])("matches %j", (q) => expect(adrMatches(row, q)).toBe(true));
  it.each(["4", "adr-4", "adr-0004"])("rejects %j", (q) => expect(adrMatches(row, q)).toBe(false));
});
