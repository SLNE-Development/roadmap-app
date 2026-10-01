import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

describe("encryptSecret / decryptSecret", () => {
  beforeEach(() => {
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips a secret in the v1 format", () => {
    const value = encryptSecret("https://discord.com/api/webhooks/1/abc");
    expect(value).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(decryptSecret(value)).toBe("https://discord.com/api/webhooks/1/abc");
  });

  it("gives two encryptions of the same text different values", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("refuses a tampered ciphertext", () => {
    const value = encryptSecret("secret text");
    // The first character of the ciphertext carries six full bits, so changing it always changes a byte.
    const at = value.lastIndexOf(".") + 1;
    const flipped = value[at] === "A" ? "B" : "A";
    expect(() => decryptSecret(value.slice(0, at) + flipped + value.slice(at + 1))).toThrow("Cannot decrypt secret");
  });

  it("refuses a value encrypted with another key", () => {
    const value = encryptSecret("secret text");
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    expect(() => decryptSecret(value)).toThrow("Cannot decrypt secret");
  });

  it("names the variable when the key is missing or not 32 bytes", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => encryptSecret("x")).toThrow("ENCRYPTION_KEY");
    vi.stubEnv("ENCRYPTION_KEY", randomBytes(16).toString("base64"));
    expect(() => encryptSecret("x")).toThrow("ENCRYPTION_KEY");
  });
});
