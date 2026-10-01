import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signBody, verifySignature } from "./signature";

describe("verifySignature", () => {
  it("accepts a body signed with the secret", () => {
    expect(verifySignature(["s"], "{}", signBody("s", "{}"))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifySignature(["s"], "{}", signBody("other", "{}"))).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifySignature(["s"], "{}", null)).toBe(false);
  });

  it("rejects sha1 signatures", () => {
    const hex = createHmac("sha1", "s").update("{}").digest("hex");
    expect(hex).toHaveLength(40);
    expect(verifySignature(["s"], "{}", `sha1=${hex}`)).toBe(false);
  });

  it("rejects a digest of the wrong length", () => {
    expect(verifySignature(["s"], "{}", signBody("s", "{}").slice(0, -1))).toBe(false);
  });

  it("rejects uppercase hex of the correct digest", () => {
    const hex = signBody("s", "{}").slice("sha256=".length);
    expect(verifySignature(["s"], "{}", `sha256=${hex.toUpperCase()}`)).toBe(false);
  });

  it("accepts a body signed with any of the secrets", () => {
    expect(verifySignature(["new", "old"], "{}", signBody("old", "{}"))).toBe(true);
  });
});
