"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useTRPC } from "@/trpc/client";
import { NotificationList } from "./notification-list";

/** How often the unread count refetches while the tab is visible. */
const UNREAD_REFRESH_MS = 60_000;
/** Rows the popover shows. */
const LATEST = 10;

/** The unread count as the badge reads it. */
function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/**
 * The notification bell: a bell with the unread count, opening the latest rows with
 * "Mark all read" and "See all". Clicking a row marks it read and opens it.
 *
 * @param props.className classes of the trigger button, which differs between the sidebar and the mobile bar
 */
export function NotificationBell({ className }: { className?: string }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const { data: unread = 0 } = useQuery({ ...trpc.notifications.unread.queryOptions(), refetchInterval: UNREAD_REFRESH_MS });
  const latest = useQuery({ ...trpc.notifications.list.queryOptions({ limit: LATEST }), enabled: open });
  const markRead = useMutation(trpc.notifications.markRead.mutationOptions());
  const markAllRead = useMutation(trpc.notifications.markAllRead.mutationOptions());
  const label = unread > 0 ? `Notifications, ${badgeText(unread)} unread` : "Notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={cn("relative flex shrink-0 items-center justify-center", className)}>
          <Bell className="size-[17px]" aria-hidden />
          {unread > 0 && (
            <Badge aria-hidden className="absolute -top-1 -right-1 h-4 min-w-4 rounded-none px-1 text-[10px] font-semibold tabular-nums">
              {badgeText(unread)}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 gap-0 rounded-none p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <span className="text-xs text-muted-foreground">{unread > 0 ? `${badgeText(unread)} unread` : "All read"}</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {latest.isPending ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>
          ) : latest.error ? (
            <p className="px-3 py-4 text-sm text-cat-blocked">{latest.error.message}</p>
          ) : latest.data.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">Nothing yet. Mentions and changes to your work show up here.</p>
          ) : (
            <NotificationList
              compact
              items={latest.data}
              onOpen={(n) => {
                if (n.readAt === null) markRead.mutate({ ids: [n.id] });
                setOpen(false);
              }}
            />
          )}
        </div>
        <div className="flex items-center justify-between border-t px-3 py-2 text-[13px]">
          <button
            type="button"
            disabled={unread === 0 || markAllRead.isPending}
            onClick={() => markAllRead.mutate()}
            className="font-medium text-brand-strong hover:underline disabled:text-muted-foreground disabled:no-underline"
          >
            Mark all read
          </button>
          <Link href="/notifications" onClick={() => setOpen(false)} className="font-medium text-brand-strong hover:underline">
            See all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
