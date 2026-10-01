/** Returns the parts of `date` as wall-clock time in `timeZone`. */
function wallClock(date: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, Number(p.value)]));
}

/** Formats `date` as `YYYY-MM-DDTHH:mm` on the clock of `timeZone`, the value of a `datetime-local` input. */
export function toZonedInput(date: Date, timeZone: string): string {
  const p = wallClock(date, timeZone);
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Reads a `datetime-local` value as a time on the clock of `timeZone`; returns `null` for an empty or invalid value. */
export function fromZonedInput(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number);
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  // Start from the wall clock read as UTC, then correct by the zone's offset at that moment (twice, for offset changes).
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const p = wallClock(new Date(guess), timeZone);
    guess += wanted - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  const date = new Date(guess);
  return Number.isNaN(date.getTime()) ? null : date;
}
