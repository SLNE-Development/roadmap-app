import { describe, expect, it } from "vitest";
import { bearerToken } from "./bearer";

describe("bearerToken", () => {
  it("extracts the token of a Bearer header, case-insensitively", () => {
    expect(bearerToken("Bearer rmk_abc")).toBe("rmk_abc");
    expect(bearerToken("bearer   rmk_abc  ")).toBe("rmk_abc");
  });

  it("rejects missing, empty and other schemes", () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken("Bearer ")).toBeNull();
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
  });
});
