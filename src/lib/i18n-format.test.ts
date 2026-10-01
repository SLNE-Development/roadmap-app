import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../messages/de";
import en from "../../messages/en";

const LOCALES = { en, de } as const;

/** Every dotted path of a string leaf. */
function leaves(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (node && typeof node === "object") return Object.entries(node).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
  return [];
}

/** Dummy values for every argument of a message, by the type the argument is used as. */
function dummyValues(elements: MessageFormatElement[], out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const el of elements) {
    if (el.type === TYPE.argument || el.type === TYPE.select) out[el.value] = "other";
    else if (el.type === TYPE.number || el.type === TYPE.plural) out[el.value] = 1;
    else if (el.type === TYPE.date || el.type === TYPE.time) out[el.value] = new Date(0);
    else if (el.type === TYPE.tag) out[el.value] = (chunks: unknown) => chunks;
    if (el.type === TYPE.plural || el.type === TYPE.select) for (const option of Object.values(el.options)) dummyValues(option.value, out);
    if (el.type === TYPE.tag) dummyValues(el.children, out);
  }
  return out;
}

const text = (root: unknown, path: string): string => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], root) as string;

describe.each(Object.entries(LOCALES))("messages %s", (locale, messages) => {
  const errors: unknown[] = [];
  const t = createTranslator({ locale: locale as "en" | "de", messages: messages as never, onError: (e) => errors.push(e), getMessageFallback: ({ key }) => `FORMATTING_ERROR ${key}` }) as unknown as (key: string, values?: object) => string;

  it("formats every message without an error", () => {
    const bad = leaves(messages).filter((path) => t(path, dummyValues(parse(text(messages, path)))).startsWith("FORMATTING_ERROR"));
    expect(bad).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("shows placeholder names in the fallback help as literal braces", () => {
    const text = t("events.fallback.playerMessageHelp");
    expect(text).toContain("{event}");
    expect(text).toContain("{start_date}");
  });
});
