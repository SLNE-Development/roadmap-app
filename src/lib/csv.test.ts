import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "./csv";

describe("csvCell", () => {
  it("leaves plain text alone and writes null as empty and numbers as they are", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });

  it("quotes commas, quotes and line breaks, doubling quotes", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralises formulas with a leading apostrophe", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    for (const start of ["+", "-", "@", "\t"]) expect(csvCell(`${start}1`)).toBe(`'${start}1`);
    expect(csvCell("\rx")).toBe('"\'\rx"');
    expect(csvCell('=A1,"x"')).toBe('"\'=A1,""x"""');
  });
});

describe("csvRow", () => {
  it("joins cells and ends in CRLF", () => {
    expect(csvRow(["a", null, 3, "b,c"])).toBe('a,,3,"b,c"\r\n');
  });
});
