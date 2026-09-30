import { describe, expect, it } from "vitest";
import { isOwnPush } from "./systems-toolbar";

describe("isOwnPush", () => {
  it("recognises the q the toolbar just pushed", () => {
    expect(isOwnPush("log", "log")).toBe(true);
  });

  it("treats any other q as an outside change", () => {
    expect(isOwnPush("", "log")).toBe(false);
    expect(isOwnPush("log", undefined)).toBe(false);
  });
});
