import { describe, expect, it } from "vitest";
import en from "../../../messages/en";
import { SHORTCUTS } from "@/lib/shortcuts";
import { LABELS } from "./shortcuts-dialog";

describe("shortcut labels", () => {
  it("has a translated label for every shortcut", () => {
    for (const s of SHORTCUTS) {
      const key = LABELS[s.keys.join(" ")];
      expect(key, s.keys.join(" ")).toBeDefined();
      expect(en.shell.shortcuts).toHaveProperty(key);
    }
  });
});
