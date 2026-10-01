import type { EventRequestRow } from "@/db/schema";
import { discordTimestamp } from "./discord-timestamp";

/** The placeholders message templates may hold, written `{name}`. */
export const PLACEHOLDERS = ["event", "start", "start_date", "start_time", "end_date", "end_time", "countdown", "duration", "where", "docs", "rules", "note"] as const;

/** One of {@link PLACEHOLDERS}. */
export type Placeholder = (typeof PLACEHOLDERS)[number];

/** The placeholders every template may use; `{note}` belongs to the resolved and disaster messages alone. */
export const DEFAULT_ALLOWED: readonly Placeholder[] = PLACEHOLDERS.filter((p) => p !== "note");

/** The placeholders the editors show as chips: `{note}` is added where it is allowed. */
export const VISIBLE_PLACEHOLDERS: readonly Placeholder[] = DEFAULT_ALLOWED;

/** Old names that still work: they fill like the placeholder they point to, and are not shown. */
export const PLACEHOLDER_ALIASES: Record<string, Placeholder> = { date: "start_date", time: "start_time" };

/** How a placeholder is written: as Discord timestamps (message content) or as plain German text (titles, footers, previews). */
export type FillMode = "discord" | "text";

/** `{name}`, but not the inner part of `{{name}}`: double braces are no escape and stay as written. */
const TOKEN = /(?<!\{)\{(\w+)\}(?!\})/g;

const isPlaceholder = (name: string): name is Placeholder => (PLACEHOLDERS as readonly string[]).includes(name);

/** The placeholder a name stands for, resolving aliases; undefined for an unknown name. */
const resolve = (name: string): Placeholder | undefined => (isPlaceholder(name) ? name : PLACEHOLDER_ALIASES[name]);

type Values = Partial<Record<Placeholder, string>>;

/**
 * Replaces `{name}` with its value, for the known names in `allow` only (all but `note` by default). An alias is allowed
 * when its target is. Unknown names stay as written. A value is inserted as plain text and never scanned again. When a
 * replacement is empty, doubled spaces on that line collapse and trailing space is removed. `values` is one set, or the
 * two sets of {@link placeholderValues}, of which `mode` (default `discord`) picks one.
 */
export function fillPlaceholders(
  template: string,
  values: Record<FillMode, Values> | Values,
  opts: { allow?: readonly Placeholder[]; mode?: FillMode } = {},
): string {
  const allow = opts.allow ?? DEFAULT_ALLOWED;
  const picked: Values = "discord" in values && "text" in values ? (values as Record<FillMode, Values>)[opts.mode ?? "discord"] : (values as Values);
  return template
    .split("\n")
    .map((line) => {
      let emptied = false;
      const filled = line.replace(TOKEN, (token, name: string) => {
        const key = resolve(name);
        if (!key || !allow.includes(key)) return token;
        const value = picked[key] ?? "";
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
  for (const [, name] of text.matchAll(TOKEN)) {
    const key = resolve(name);
    if (!key || !allow.includes(key)) unknown.add(name);
  }
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
 * The values of the placeholders for a request, in both forms: `discord` has timestamps Discord shows in each reader's own
 * zone, `text` has German text in the settings' time zone. The end is the start plus the duration. Missing data gives an
 * empty string.
 */
export function placeholderValues(
  request: Pick<EventRequestRow, "title" | "startsAt" | "durationMinutes" | "where" | "eventDocsUrl">,
  settings: { timeZone: string; rulebookUrl: string | null },
  note?: string,
): Record<FillMode, Record<Placeholder, string>> {
  const start = request.startsAt;
  const end = start && request.durationMinutes && request.durationMinutes > 0 ? new Date(start.getTime() + request.durationMinutes * 60_000) : null;
  const zoned = (options: Intl.DateTimeFormatOptions) => (at: Date) => new Intl.DateTimeFormat("de-DE", { timeZone: settings.timeZone, ...options }).format(at);
  const longDate = zoned({ dateStyle: "long" });
  const clock = zoned({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const time = (at: Date) => `${clock(at)} Uhr`;
  const common = { event: request.title, duration: durationText(request.durationMinutes), docs: request.eventDocsUrl ?? "", rules: settings.rulebookUrl ?? "", where: request.where, note: note ?? "" };
  return {
    discord: {
      ...common,
      start: start ? discordTimestamp(start, "F") : "",
      start_date: start ? discordTimestamp(start, "D") : "",
      start_time: start ? discordTimestamp(start, "t") : "",
      end_date: end ? discordTimestamp(end, "D") : "",
      end_time: end ? discordTimestamp(end, "t") : "",
      countdown: start ? discordTimestamp(start, "R") : "",
    },
    text: {
      ...common,
      start: start ? `${zoned({ dateStyle: "full" })(start)} um ${time(start)}` : "",
      start_date: start ? longDate(start) : "",
      start_time: start ? time(start) : "",
      end_date: end ? longDate(end) : "",
      end_time: end ? time(end) : "",
      countdown: "",
    },
  };
}
