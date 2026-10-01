"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { PersonName } from "@/components/person-avatar";
import { Badge } from "@/components/ui/badge";
import type { RequestStatus } from "@/lib/event-status";
import type { RequestListItem } from "@/lib/ops/requests";
import { cn } from "@/lib/utils";

/** Badge colours per status, from the app's category tokens. */
const STATUS_CLASS: Record<RequestStatus, string> = {
  draft: "bg-secondary text-muted-foreground",
  submitted: "bg-brand-soft text-brand-strong",
  accepted: "bg-cat-planning-soft text-cat-planning",
  event_week: "bg-cat-active-soft text-cat-active",
  done: "bg-cat-done-soft text-cat-done",
  cancelled: "border-destructive/40 text-destructive",
  withdrawn: "bg-secondary text-muted-foreground",
};

/** The status of a request as a coloured badge. */
export function StatusBadge({ status }: { status: RequestStatus }) {
  const t = useTranslations("events.status");
  return (
    <Badge variant="outline" className={cn("border-transparent", STATUS_CLASS[status])}>
      {t(status)}
    </Badge>
  );
}

/** Weekday, day and month of the event start, or a muted "No date" block. */
function DateBlock({ startsAt }: { startsAt: Date | null }) {
  const t = useTranslations("events.list");
  const format = useFormatter();
  if (!startsAt) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-dashed text-center text-[10.5px] leading-tight text-muted-foreground">{t("noDate")}</div>
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center border bg-secondary leading-none">
      <span className="text-[10.5px] text-muted-foreground">{format.dateTime(startsAt, { weekday: "short" })}</span>
      <span className="font-display text-[19px] font-semibold tabular-nums">{format.dateTime(startsAt, { day: "numeric" })}</span>
      <span className="text-[10.5px] text-muted-foreground">{format.dateTime(startsAt, { month: "short" })}</span>
    </div>
  );
}

/**
 * The start time always shows: "21:17–23:47" within one day, "21:17 – Sun 00:00" when the end is on the next day within 24 hours,
 * "3 Oct, 21:17 – 5 Oct, 18:00" for longer events. The start time alone without an end.
 */
export function useWhen(r: Pick<RequestListItem, "startsAt" | "endsAt">): string | null {
  const format = useFormatter();
  if (!r.startsAt) return null;
  const time = (d: Date) => format.dateTime(d, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  if (!r.endsAt) return time(r.startsAt);
  const day = (d: Date) => format.dateTime(d, { year: "numeric", month: "numeric", day: "numeric" });
  if (day(r.startsAt) === day(r.endsAt)) return `${time(r.startsAt)}–${time(r.endsAt)}`;
  const dash = " – ";
  if (r.endsAt.getTime() - r.startsAt.getTime() < 86_400_000) return `${time(r.startsAt)}${dash}${format.dateTime(r.endsAt, { weekday: "short" })} ${time(r.endsAt)}`;
  const stamp = (d: Date) => `${format.dateTime(d, { day: "numeric", month: "short" })}, ${time(d)}`;
  return `${stamp(r.startsAt)}${dash}${stamp(r.endsAt)}`;
}

/** One request of the list: date block, title, status, time, requester, project and what needs attention. */
export function RequestRow({ r }: { r: RequestListItem }) {
  const t = useTranslations("events.list");
  const when = useWhen(r);
  return (
    <li className="flex items-center gap-3.5 border-t px-4 py-3 first:border-t-0 sm:px-5">
      <DateBlock startsAt={r.startsAt} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link href={`/requests/${r.id}`} className="text-[14.5px] font-medium hover:underline">
            {r.title}
          </Link>
          <StatusBadge status={r.status} />
          {r.waitingOnRequester && <Badge variant="outline">{t("waitingOnRequester")}</Badge>}
          {r.lateTodos > 0 && <Badge variant="destructive">{t("lateTodos", { count: r.lateTodos })}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-fg-2">
          {when && <span className="tabular-nums">{when}</span>}
          <PersonName name={r.requesterName} />
          {r.projectSlug && (
            <Link href={`/p/${r.projectSlug}`} className="border bg-card px-1.5 py-px hover:text-foreground hover:underline">
              {r.projectSlug}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}
