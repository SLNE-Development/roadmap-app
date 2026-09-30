import { describe, expect, it } from "vitest";
import { requireEnv } from "./env";

describe("requireEnv", () => {
  it("passes when every variable is set", () => {
    expect(() => requireEnv(["A", "B"], { A: "1", B: "2" })).not.toThrow();
  });

  it("throws for a missing variable", () => {
    expect(() => requireEnv(["A", "B"], { A: "1" })).toThrow("B is not set; see .env.example.");
  });

  it("treats an empty variable as missing", () => {
    expect(() => requireEnv(["A", "B"], { A: "", B: "2" })).toThrow("A is not set; see .env.example.");
  });
});
