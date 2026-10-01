/** Short English month names, January first. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Formats a date as "12 Sep", adding the year when it differs from `now`'s,
 * in UTC so server and client render the same text.
 *
 * @param iso an ISO 8601 timestamp
 * @param now the reference time, defaulting to the current time
 */
export function formatDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

/** Formats the UTC time of day of `iso` as "09:05". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/**
 * Names the UTC day of `iso` for grouping a timeline: "Today", "Yesterday",
 * or the date from {@link formatDate}.
 */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const day = (d: Date) => Math.floor(d.getTime() / 86_400_000);
  const diff = day(now) - day(new Date(iso));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return formatDate(iso, now);
}

/**
 * Formats how long ago `iso` was relative to `now`: "just now", minutes, hours,
 * days, or the date from {@link formatDate} after 30 days.
 *
 * @param iso an ISO 8601 timestamp
 * @param now the reference time, defaulting to the current time
 */
export function relativeAge(iso: string, now: Date = new Date()): string {
  const seconds = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${days} d ago`;
  return formatDate(iso, now);
}

/**
 * Counts the UTC days from `now`'s day to a date's day: positive before it, 0 on it, negative after it.
 *
 * @param date a UTC day key `YYYY-MM-DD`
 */
export function daysUntil(date: string, now: Date = new Date()): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
}
