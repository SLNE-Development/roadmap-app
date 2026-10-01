import { describe, expect, it } from "vitest";
import { isGateRefusal, moveErrorKind } from "./move-error";

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

describe("isGateRefusal", () => {
  it("recognises a refusal by column rules", () => {
    expect(isGateRefusal({ data: { code: "CONFLICT" }, message: "Can't move login to Review. Missing: no spec." })).toBe(true);
    expect(isGateRefusal({ data: { code: "CONFLICT" }, message: "System login is still in planning." })).toBe(false);
    expect(isGateRefusal({ data: { code: "FORBIDDEN" }, message: "Can't move login." })).toBe(false);
  });
});
