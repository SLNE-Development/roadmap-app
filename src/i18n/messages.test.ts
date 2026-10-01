import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import de from "../../messages/de";
import en from "../../messages/en";

/** Flattens nested messages to dotted keys. */
function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") Object.assign(out, flatten(value as Record<string, unknown>, path));
    else out[path] = String(value);
  }
  return out;
}

/** The ICU argument names used in a message, such as `count` for `{count, plural, …}`. */
function icuArguments(message: string): string[] {
  const names = new Set<string>();
  for (let i = 0; i < message.length; i++) {
    const ch = message[i];
    if (ch === "{") {
      // A `{` followed by an identifier opens an argument, also inside plural and select branches.
      const m = /^\{\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(message.slice(i));
      if (m) names.add(m[1]);
    }
  }
  return [...names].sort();
}

const flatEn = flatten(en);
const flatDe = flatten(de);

describe("message files", () => {
  it("list every namespace file in the index of its language", () => {
    for (const [locale, messages] of [["en", en], ["de", de]] as const) {
      const files = readdirSync(join(__dirname, "../../messages", locale))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -".json".length))
        .sort();
      expect({ [locale]: Object.keys(messages).sort() }).toEqual({ [locale]: files });
    }
  });

  it("have the same keys", () => {
    const missingInDe = Object.keys(flatEn).filter((k) => !(k in flatDe));
    const missingInEn = Object.keys(flatDe).filter((k) => !(k in flatEn));
    expect({ "missing in de": missingInDe, "missing in en": missingInEn }).toEqual({
      "missing in de": [],
      "missing in en": [],
    });
  });

  it("have no empty values", () => {
    const empty = [...Object.entries(flatEn), ...Object.entries(flatDe)].filter(([, v]) => !v.trim()).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it("use the same ICU arguments per key", () => {
    const mismatched = Object.keys(flatEn)
      .filter((k) => k in flatDe)
      .filter((k) => icuArguments(flatEn[k]).join() !== icuArguments(flatDe[k]).join());
    expect(mismatched).toEqual([]);
  });

  it("give every German plural an other branch", () => {
    const bad = Object.entries(flatDe)
      .filter(([, v]) => /\{\s*\w+\s*,\s*plural\s*,/.test(v) && !/\bother\s*\{/.test(v))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("extracts ICU arguments", () => {
    expect(icuArguments("{count, plural, one {# item} other {# items}} for {name}")).toEqual(["count", "name"]);
  });
});

describe("message key typing", () => {
  it("rejects unknown keys at typecheck", () => {
    const t = (key: keyof typeof en.common) => key;
    // @ts-expect-error an unknown key is not assignable
    t("doesNotExist");
    expect(t("save")).toBe("save");
  });
});
