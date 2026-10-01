import { useFormatter } from "next-intl";

/** Returns a formatter of dates as "12 Sep", with the year when it is not the one of `now`. */
export function useShortDate(now: Date): (at: Date) => string {
  const format = useFormatter();
  return (at) =>
    format.dateTime(at, {
      day: "numeric",
      month: "short",
      ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const }),
    });
}
