"use client";

import { useFormatter } from "next-intl";
import { useNow } from "@/components/clock";

/**
 * Returns a function formatting how long ago a date was ("5 minutes ago") against the render clock. A date
 * newer than the clock (the clock was taken before it, or the machines disagree) reads as "now", not as the future.
 */
export function useRelativeTime(): (date: Date | string) => string {
  const format = useFormatter();
  const now = useNow();
  return (date) => {
    const d = typeof date === "string" ? new Date(date) : date;
    return format.relativeTime(d, d.getTime() > now.getTime() ? d : now);
  };
}
