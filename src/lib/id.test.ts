import { describe, expect, it } from "vitest";
import { newId } from "./id";

describe("newId", () => {
  it("returns a version 7 UUID", () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("encodes the millisecond timestamp in the first 48 bits", () => {
    expect(newId(0x0123456789ab).slice(0, 13)).toBe("01234567-89ab");
  });

  it("sorts by creation time", () => {
    expect(newId(1000) < newId(2000)).toBe(true);
  });
});
