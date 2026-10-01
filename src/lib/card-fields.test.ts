import { describe, expect, it } from "vitest";
import { normalizeCardFields } from "./card-fields";

describe("normalizeCardFields", () => {
  it("drops unknown values, duplicates and custom fields that are gone, keeping order", () => {
    expect(normalizeCardFields(["owner", "owner", "bogus", "custom:f1", "custom:gone"], ["f1"])).toEqual(["owner", "custom:f1"]);
  });

  it("returns an empty list for anything but an array", () => {
    expect(normalizeCardFields("owner", [])).toEqual([]);
    expect(normalizeCardFields(null, [])).toEqual([]);
  });

  it("caps the list at eight fields", () => {
    const ten = ["owner", "tasks", "blocked", "phase", "domain", "priority", "questions", "estimate", "dependencies", "gates"];
    expect(normalizeCardFields(ten, [])).toEqual(ten.slice(0, 8));
  });
});
