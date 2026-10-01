const DAY_MS = 86_400_000;

// newer ICU data spells September "Sept" in en-GB; labels use the three-letter form
const dayLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Linear map from a domain to a range, with `invert`; a degenerate domain maps everything to the range start. */
export function linearScale(
  domain: [number, number],
  range: [number, number],
): ((value: number) => number) & { invert(px: number): number } {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const flat = d1 === d0;
  const scale = (value: number) => (flat ? r0 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0));
  scale.invert = (px: number) => (r1 === r0 ? d0 : d0 + ((px - r0) / (r1 - r0)) * (d1 - d0));
  return scale;
}

/** Evenly spaced ticks from 0 up to the first multiple of the step at or above `max`; the step is 1, 2 or 5 × 10^k. */
export function niceTicks(max: number, target = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

/** Every UTC `YYYY-MM-DD` key from `from` to `to`, inclusive. */
export function dayKeys(from: Date, to: Date): string[] {
  const start = Math.floor(from.getTime() / DAY_MS) * DAY_MS;
  const end = Math.floor(to.getTime() / DAY_MS) * DAY_MS;
  const keys: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) keys.push(new Date(t).toISOString().slice(0, 10));
  return keys;
}

/** Evenly spaced axis ticks over day keys, always including the first and last, labelled like "2 Sep". */
export function dayTicks(keys: string[], maxTicks = 5): { index: number; label: string }[] {
  if (keys.length === 0) return [];
  const count = Math.max(1, Math.min(maxTicks, keys.length));
  const last = keys.length - 1;
  const indexes = new Set<number>();
  for (let i = 0; i < count; i++) indexes.add(count === 1 ? 0 : Math.round((i * last) / (count - 1)));
  return [...indexes].map((index) => ({
    index,
    label: dayLabel.format(new Date(`${keys[index]}T00:00:00Z`)).replace("Sept", "Sep"),
  }));
}

/** The UTC day key `n` days after `key` (negative `n` goes back). */
export function addDays(key: string, n: number): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
