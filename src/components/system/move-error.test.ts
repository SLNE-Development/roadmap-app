import { describe, expect, it } from "vitest";
import { moveErrorKind } from "./move-error";

describe("moveErrorKind", () => {
  it("recognises the planning gate", () => {
    expect(moveErrorKind({ data: { code: "CONFLICT" }, message: "System x is still in planning: missing summary." })).toBe("planning-gate");
  });

  it("treats other refusals and network errors as other", () => {
    expect(moveErrorKind({ data: { code: "FORBIDDEN" }, message: "System x is still in planning." })).toBe("other");
    expect(moveErrorKind({ data: { code: "CONFLICT" }, message: "Column was removed." })).toBe("other");
    expect(moveErrorKind(new Error("fetch failed"))).toBe("other");
  });
});
