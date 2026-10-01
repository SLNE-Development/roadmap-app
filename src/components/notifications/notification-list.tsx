"use client";

import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useNow } from "@/components/clock";
import type { NotificationItem } from "@/lib/ops/notifications";
import { cn } from "@/lib/utils";

/**
 * Inbox rows: a dot when unread (bold title), the title, the project and the age.
 * Clicking a row calls `onOpen` and follows its link.
 *
 * @param props.items the notifications, newest first
 * @param props.onOpen called when a row is clicked, before navigating
 * @param props.compact the tighter rows of the bell's popover
 */
export function NotificationList({
  items,
  onOpen,
  compact,
}: {
  items: NotificationItem[];
  onOpen: (item: NotificationItem) => void;
  compact?: boolean;
}) {
  const t = useTranslations("notifications.list");
  const format = useFormatter();
  const now = useNow();
  return (
    <ul className="flex flex-col">
      {items.map((n) => {
        const unread = n.readAt === null;
        return (
          <li key={n.id} className="border-t first:border-t-0">
            <Link
              href={n.href}
              data-nav-item
              onClick={() => onOpen(n)}
              className={cn(
                "flex items-start gap-2.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none",
                compact ? "px-3 py-2.5" : "px-4 py-3.5 sm:px-5",
              )}
            >
              <span aria-hidden className={cn("mt-[7px] size-2 shrink-0", unread ? "bg-brand-strong" : "bg-transparent")} />
              <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                <span className={cn("text-[13.5px]", unread ? "font-semibold" : "font-medium text-fg-2")}>
                  {unread && <span className="sr-only">{t("unread")}</span>}
                  {n.title}
                </span>
                {!compact && n.body && <span className="line-clamp-2 text-[13px] leading-[1.45] text-fg-2">{n.body}</span>}
                <span className="text-xs text-muted-foreground">
                  {n.projectName} · {format.relativeTime(n.createdAt, now)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
