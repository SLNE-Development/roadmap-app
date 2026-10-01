"use client";

import { useFormatter } from "next-intl";
import { useNow } from "@/components/clock";

/**
 * Returns a function formatting a date as "12 Sep" (locale-specific), adding the year when it differs from
 * the render clock's. A timestamp is shown, and its year compared, in the user's time zone; a day key `YYYY-MM-DD`
 * (pass `{ dayKey: true }`) is shown as the same calendar day in every time zone.
 */
export function useShortDate(): (date: Date | string, options?: { dayKey?: boolean }) => string {
  const format = useFormatter();
  const now = useNow();
  return (date, { dayKey = false } = {}) => {
    const d = typeof date === "string" ? new Date(dayKey ? `${date}T00:00:00Z` : date) : date;
    const zone = dayKey ? { timeZone: "UTC" } : {};
    const sameYear = format.dateTime(d, { year: "numeric", ...zone }) === format.dateTime(now, { year: "numeric", ...zone });
    return format.dateTime(d, { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), ...zone });
  };
}
