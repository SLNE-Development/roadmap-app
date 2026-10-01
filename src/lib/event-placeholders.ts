import type { EventRequestRow } from "@/db/schema";

/** The placeholders message templates may hold, written `{name}`. */
export const PLACEHOLDERS = ["event", "date", "time", "duration", "docs", "rules", "where", "note"] as const;

/** One of {@link PLACEHOLDERS}. */
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** The placeholders every template may use; `{note}` belongs to the resolved message alone. */
export const DEFAULT_ALLOWED: readonly Placeholder[] = PLACEHOLDERS.filter((p) => p !== "note");

/** `{name}`, but not the inner part of `{{name}}`: double braces are no escape and stay as written. */
const TOKEN = /(?<!\{)\{(\w+)\}(?!\})/g;

const isPlaceholder = (name: string): name is Placeholder => (PLACEHOLDERS as readonly string[]).includes(name);

/**
 * Replaces `{name}` with its value, for the known names in `allow` only (all but `note` by default). Unknown names stay
 * as written. A value is inserted as plain text and never scanned again. When a replacement is empty, doubled spaces on
 * that line collapse and trailing space is removed.
 */
export function fillPlaceholders(template: string, values: Partial<Record<Placeholder, string>>, opts: { allow?: readonly Placeholder[] } = {}): string {
  const allow = opts.allow ?? DEFAULT_ALLOWED;
  return template
    .split("\n")
    .map((line) => {
      let emptied = false;
      const filled = line.replace(TOKEN, (token, name: string) => {
        if (!isPlaceholder(name) || !allow.includes(name)) return token;
        const value = values[name] ?? "";
        if (value === "") emptied = true;
        return value;
      });
      return emptied ? filled.replace(/ {2,}/g, " ").replace(/[ \t]+$/, "") : filled;
    })
    .join("\n");
}

/** Returns the names in `text` that are not known placeholders or not allowed here, once each; the editor warns about them. */
export function validateTemplate(text: string, allow: readonly Placeholder[]): string[] {
  const unknown = new Set<string>();
  for (const [, name] of text.matchAll(TOKEN)) if (!isPlaceholder(name) || !allow.includes(name)) unknown.add(name);
  return [...unknown];
}

/** The German length of an event: `2 Stunden`, `1 Stunde 30 Minuten`, `45 Minuten`; empty without a positive duration. */
function durationText(minutes: number | null): string {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h > 0 ? `${h} ${h === 1 ? "Stunde" : "Stunden"}` : "", m > 0 ? `${m} ${m === 1 ? "Minute" : "Minuten"}` : ""].filter(Boolean).join(" ");
}

/**
 * The values of the placeholders for a request: the date and time in the settings' time zone, German formatted. Missing
 * data gives an empty string. `now` is accepted for callers that pass a clock; no value depends on it.
 */
export function placeholderValues(
  request: Pick<EventRequestRow, "title" | "startsAt" | "durationMinutes" | "where" | "eventDocsUrl">,
  settings: { timeZone: string; rulebookUrl: string | null },
  _now?: Date,
  note?: string,
): Record<Placeholder, string> {
  const at = request.startsAt;
  return {
    event: request.title,
    date: at ? new Intl.DateTimeFormat("de-DE", { dateStyle: "full", timeZone: settings.timeZone }).format(at) : "",
    time: at ? `${new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: settings.timeZone }).format(at)} Uhr` : "",
    duration: durationText(request.durationMinutes),
    docs: request.eventDocsUrl ?? "",
    rules: settings.rulebookUrl ?? "",
    where: request.where,
    note: note ?? "",
  };
}
