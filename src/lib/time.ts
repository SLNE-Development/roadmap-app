/**
 * Formats how long ago `iso` was relative to `now`: "just now", minutes, hours,
 * days, or the plain date after 30 days.
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
  return iso.slice(0, 10);
}
