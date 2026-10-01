import { z } from "zod";
import { NOTIFICATION_KINDS, type NotificationKind } from "./notification-kinds";

/** The preference key that holds a user's notification rules. */
export const NOTIFY_RULES_PREF = "notify.rules";

/** Seconds a user counts as active after their last request. */
export const ACTIVE_TTL_SECONDS = 90;

/** The `Kv` key that marks a user as active. */
export function activeKey(userId: string): string {
  return `active:${userId}`;
}

const kindRule = z.object({ inbox: z.boolean(), push: z.boolean() });
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** An IANA time zone name the runtime knows, such as `Europe/Berlin`. */
export const timeZoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Unknown time zone.");
const quiet = z.object({ enabled: z.boolean(), start: clock, end: clock, timeZone: timeZoneSchema });
const kindShape = Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, kindRule])) as Record<NotificationKind, typeof kindRule>;

/** Schema of the stored rules. */
export const notifyRulesSchema = z.object({
  kinds: z.object(kindShape),
  quiet,
  skipPushWhileActive: z.boolean(),
});

/** A user's notification rules. */
export type NotifyRules = z.infer<typeof notifyRulesSchema>;

/** What may be stored: any part can be missing and falls back to the defaults. */
export const storedNotifyRulesSchema = z.object({
  kinds: z.object(kindShape).partial().optional(),
  quiet: quiet.partial().optional(),
  skipPushWhileActive: z.boolean().optional(),
});

const PUSH_BY_DEFAULT: NotificationKind[] = [
  "mention",
  "question.answered",
  "question.asked",
  "planning.round",
  "task.blocked",
  "system.blocked",
  "task.assigned",
];

/** The rules of a user who set none. */
export const DEFAULT_NOTIFY_RULES: NotifyRules = {
  kinds: Object.fromEntries(NOTIFICATION_KINDS.map((k) => [k, { inbox: true, push: PUSH_BY_DEFAULT.includes(k) }])) as NotifyRules["kinds"],
  quiet: { enabled: false, start: "22:00", end: "08:00", timeZone: "UTC" },
  skipPushWhileActive: true,
};

/** Returns whether `kind` goes to the inbox under `rules`. */
export function wantsInbox(rules: NotifyRules, kind: NotificationKind): boolean {
  return rules.kinds[kind].inbox;
}

/** Returns whether `kind` may be pushed under `rules`. */
export function wantsPush(rules: NotifyRules, kind: NotificationKind): boolean {
  return rules.kinds[kind].push;
}

/** Returns the minutes since local midnight at `now` in `timeZone`. */
function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return part("hour") * 60 + part("minute");
}

function toMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/** Returns whether `now` falls inside the quiet hours, which may span midnight, in the time zone of the rules. */
export function inQuietHours(rules: NotifyRules, now: Date): boolean {
  const { enabled, start, end, timeZone: tz } = rules.quiet;
  if (!enabled) return false;
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === to) return false;
  const local = localMinutes(now, tz);
  return from < to ? local >= from && local < to : local >= from || local < to;
}

/** Decides what to do with a push: `skip` it, hold it until quiet hours end (`later`), or `send` it now. */
export function pushDecision(rules: NotifyRules, kind: NotificationKind, now: Date, isActive: boolean): "send" | "skip" | "later" {
  if (!wantsPush(rules, kind)) return "skip";
  if (inQuietHours(rules, now)) return "later";
  if (rules.skipPushWhileActive && isActive) return "skip";
  return "send";
}

/**
 * Returns the next instant quiet hours end, on a whole minute; `now` when quiet hours are off.
 * Meant for a `later` decision, so `now` is inside quiet hours; outside them it gives the next end all the same.
 */
export function quietEndsAt(rules: NotifyRules, now: Date): Date {
  const { enabled, end, timeZone: tz } = rules.quiet;
  if (!enabled) return now;
  const target = toMinutes(end);
  const minute = now.getTime() - (now.getTime() % 60000);
  const ahead = (target - localMinutes(now, tz) + 1440) % 1440 || 1440;
  let at = minute + ahead * 60000;
  // Across a clock change the local time can still be off; nudge it onto the target.
  for (let i = 0; i < 2; i++) {
    const diff = ((target - localMinutes(new Date(at), tz) + 1440 + 720) % 1440) - 720;
    if (diff === 0) break;
    at += diff * 60000;
  }
  return new Date(at);
}
