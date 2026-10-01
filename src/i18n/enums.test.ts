import { describe, expect, it } from "vitest";
import de from "../../messages/de";
import en from "../../messages/en";
import { priorityKey } from "./enums";

describe("priorityKey", () => {
  it("maps each stored priority to its enums.priority key", () => {
    expect(priorityKey("MVP")).toBe("mvp");
    expect(priorityKey("Later")).toBe("later");
    expect(priorityKey("Nice to have")).toBe("niceToHave");
  });

  it("yields keys that exist in both languages", () => {
    for (const value of ["MVP", "Later", "Nice to have"] as const) {
      expect(en.enums.priority[priorityKey(value)]).toBeTruthy();
      expect(de.enums.priority[priorityKey(value)]).toBeTruthy();
    }
  });
});
