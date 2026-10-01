/**
 * Counts the UTC days from `now`'s day to a date's day: positive before it, 0 on it, negative after it.
 *
 * @param date a UTC day key `YYYY-MM-DD`
 */
export function daysUntil(date: string, now: Date = new Date()): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
}
