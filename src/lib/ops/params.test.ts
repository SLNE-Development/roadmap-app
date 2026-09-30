import { describe, expect, it } from "vitest";
import { dbInt, entityId } from "./params";

describe("params", () => {
  it("rejects empty ids", () => {
    expect(entityId.safeParse("").success).toBe(false);
    expect(entityId.safeParse("  ").success).toBe(false);
    expect(entityId.safeParse("abc").success).toBe(true);
  });

  it("bounds integers to the database range", () => {
    expect(dbInt.safeParse(3e9).success).toBe(false);
    expect(dbInt.safeParse(0).success).toBe(false);
    expect(dbInt.safeParse(7).success).toBe(true);
  });
});
