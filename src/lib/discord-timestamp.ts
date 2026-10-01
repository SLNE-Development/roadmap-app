/** A Discord timestamp token: Discord shows it in each reader's own time zone and language. */
export function discordTimestamp(at: Date, style: "D" | "t" | "F" | "R"): string {
  return `<t:${Math.floor(at.getTime() / 1000)}:${style}>`;
}

const TOKEN = /<t:(-?\d+)(?::([tTdDfFR]))?>/g;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** `in 3 days` / `vor 2 Stunden` for the distance between `at` and `now`. */
function relative(at: Date, now: Date, locale: string): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  const [unit, size] = UNITS.find(([, s]) => Math.abs(seconds) >= s) ?? UNITS[UNITS.length - 1];
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(Math.trunc(seconds / size), unit);
}

/**
 * Replaces every `<t:N:X>` token with the text Discord would show, in `locale` and `timeZone`; a missing style is `f`.
 * Pure and for previews only: what is posted keeps the tokens.
 */
export function renderTimestamps(text: string, locale: string, timeZone: string, now: Date = new Date()): string {
  return text.replace(TOKEN, (token, seconds: string, style: string | undefined) => {
    const at = new Date(Number(seconds) * 1000);
    if (Number.isNaN(at.getTime())) return token;
    const format = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(at);
    switch (style ?? "f") {
      case "t":
        return format({ timeStyle: "short" });
      case "T":
        return format({ timeStyle: "medium" });
      case "d":
        return format({ day: "2-digit", month: "2-digit", year: "numeric" });
      case "D":
        return format({ dateStyle: "long" });
      case "F":
        return format({ dateStyle: "full", timeStyle: "short" });
      case "R":
        return relative(at, now, locale);
      default:
        return format({ dateStyle: "long", timeStyle: "short" });
    }
  });
}
