/** The supported UI languages. */
export const LOCALES = ["en", "de"] as const;

/** A supported UI language. */
export type Locale = (typeof LOCALES)[number];

/** The language used when neither the preference nor the browser names a supported one. */
export const DEFAULT_LOCALE: Locale = "en";

/** The time zone used when the user has not chosen a valid one. */
const DEFAULT_TIME_ZONE = "UTC";

/** Returns `value` as a supported locale, or `null`. */
function asLocale(value: unknown): Locale | null {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null;
}

/** Returns the first supported locale named by an `Accept-Language` header, honouring q-values, or `null`. */
function fromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q\s*=\s*([\d.]+)\s*$/.exec(p)?.[1]).find((v) => v !== undefined);
      const quality = q === undefined ? 1 : Number(q);
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const found = asLocale(tag.split("-")[0]);
    if (found) return found;
  }
  return null;
}

/**
 * Picks the UI language: a supported `locale` preference first, then the best supported
 * `Accept-Language` entry, then English. Never throws on unsupported or garbage input.
 *
 * @param pref the stored `locale` preference, of any shape
 * @param acceptLanguage the `Accept-Language` request header
 */
export function resolveLocale(pref: unknown, acceptLanguage: string | null): Locale {
  return asLocale(pref) ?? fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

/**
 * Returns the stored `timeZone` preference when it names a time zone the runtime knows, else `UTC`.
 *
 * @param pref the stored `timeZone` preference, of any shape
 */
export function resolveTimeZone(pref: unknown): string {
  if (typeof pref !== "string") return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: pref });
    return pref;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
