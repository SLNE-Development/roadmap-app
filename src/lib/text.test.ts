import { describe, expect, it } from "vitest";
import { plural } from "./text";

describe("plural", () => {
  it("uses the singular for one", () => expect(plural(1, "member")).toBe("1 member"));
  it("adds s otherwise", () => {
    expect(plural(2, "project")).toBe("2 projects");
    expect(plural(0, "system")).toBe("0 systems");
  });
  it("accepts an explicit plural", () => expect(plural(2, "entry", "entries")).toBe("2 entries"));
});
