/** The time zone events are planned in until the event settings hold one. */
export const DEFAULT_EVENT_TIME_ZONE = "Europe/Berlin";

/** The three fallback scenarios every request has, created empty with the request. */
export const REQUIRED_FALLBACKS = [
  { key: "server-down", title: "Server dies mid-event" },
  { key: "staff-missing", title: "Key staff missing" },
  { key: "too-few-players", title: "Too few players" },
] as const;

/** Who a template to-do belongs to: the requester or the developer who accepted the request. */
export type PrepOwner = "requester" | "developer";

/** One to-do of the prep template: due 09:00 local time, `offsetDays` from the event's local date. */
export interface PrepStep {
  key: string;
  title: string;
  offsetDays: number;
  owner: PrepOwner;
}

/** The prep to-dos created when a request is accepted. */
export const PREP_TEMPLATE: readonly PrepStep[] = [
  { key: "team-message", title: "Post the team message", offsetDays: -8, owner: "requester" },
  { key: "announcement", title: "Post the announcement", offsetDays: -7, owner: "requester" },
  { key: "build-ready", title: "Build is ready", offsetDays: -3, owner: "developer" },
  { key: "rehearsal", title: "Rehearsal", offsetDays: -2, owner: "developer" },
  { key: "reminder", title: "Post the reminder", offsetDays: -1, owner: "requester" },
  { key: "recap", title: "Recap and thank-you", offsetDays: 1, owner: "requester" },
];

/** The event-day checklist created with every request. */
export const CHECKLIST_TEMPLATE = [
  { key: "server-checked", label: "Server checked by the host" },
  { key: "staff-online", label: "Staff online" },
  { key: "rewards-ready", label: "Rewards ready" },
  { key: "fallback-read", label: "Fallback plan read by the host" },
] as const;

/** The offset of `timeZone` from UTC at the instant `at`, in milliseconds. */
export function zoneOffset(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - Math.floor(at / 1000) * 1000;
}

/**
 * Returns 09:00 local time in `timeZone` on the day `offsetDays` away from the event's local date. Daylight saving
 * time is handled by resolving the zone offset at the target day.
 */
export function dueFor(startsAt: Date, offsetDays: number, timeZone: string): Date {
  const local = new Date(startsAt.getTime() + zoneOffset(startsAt.getTime(), timeZone));
  const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + offsetDays, 9);
  let guess = wall - zoneOffset(wall, timeZone);
  guess = wall - zoneOffset(guess, timeZone);
  return new Date(guess);
}
