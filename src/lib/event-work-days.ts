import { zoneOffset } from "./event-prep-template";

const DAY_MS = 86_400_000;

/**
 * Returns how many whole Monday to Friday days passed between `from` and `to` in `timeZone`: the time that passed
 * on weekdays (by the wall clock of the zone, so a daylight saving change does not shorten a day), divided into
 * 24-hour days. A Saturday and a Sunday count nothing; there is no holiday calendar. Returns 0 when `from` is not before `to`.
 */
export function workingDaysBetween(from: Date, to: Date, timeZone: string): number {
  const start = from.getTime() + zoneOffset(from.getTime(), timeZone);
  const end = to.getTime() + zoneOffset(to.getTime(), timeZone);
  if (end <= start) return 0;
  let worked = 0;
  for (let day = Math.floor(start / DAY_MS) * DAY_MS; day < end; day += DAY_MS) {
    const weekday = new Date(day).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    worked += Math.min(end, day + DAY_MS) - Math.max(start, day);
  }
  return Math.floor(worked / DAY_MS);
}
