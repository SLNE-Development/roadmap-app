"use client";

import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { SegmentedLinks } from "@/components/activity/url-tabs";
import { NotificationList } from "@/components/notifications/notification-list";
import { EmptyState, Page, PageHeader, Panel } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

const PATH = "/notifications";
/** Rows per page. */
const PAGE = 30;

/**
 * The inbox page body: the "Unread / All" filter, "Mark all read", and the
 * notifications a page at a time with "Load more".
 *
 * @param props.unreadOnly lists only unread rows, bound to `?show=unread`
 */
export function NotificationsView({ unreadOnly }: { unreadOnly: boolean }) {
  const trpc = useTRPC();
  const { data: unread = 0 } = useQuery(trpc.notifications.unread.queryOptions());
  const list = useInfiniteQuery(
    trpc.notifications.list.infiniteQueryOptions(
      { limit: PAGE, unread: unreadOnly || undefined },
      { getNextPageParam: (page) => (page.length === PAGE ? page.at(-1)?.id : undefined) },
    ),
  );
  const markRead = useMutation(trpc.notifications.markRead.mutationOptions());
  const markAllRead = useMutation(trpc.notifications.markAllRead.mutationOptions());
  const rows = list.data?.pages.flat() ?? [];

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: "Account" }]}
        title="Notifications"
        description="Mentions of you and changes to the work you own, newest first."
        actions={
          <Button size="sm" variant="outline" disabled={unread === 0 || markAllRead.isPending} onClick={() => markAllRead.mutate()}>
            Mark all read
          </Button>
        }
      />
      <SegmentedLinks
        label="Show"
        items={[
          { label: unread > 99 ? "Unread 99+" : "Unread", count: unread > 99 ? undefined : unread, href: `${PATH}?show=unread`, active: unreadOnly },
          { label: "All", href: PATH, active: !unreadOnly },
        ]}
      />
      {list.isPending ? (
        <p className="text-sm text-muted-foreground">Loading notifications…</p>
      ) : list.error ? (
        <p className="text-sm text-cat-blocked">{list.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={unreadOnly ? "All caught up" : "No notifications yet"}
          description="When someone mentions you or changes your work, it shows up here."
        />
      ) : (
        <Panel>
          <NotificationList items={rows} onOpen={(n) => n.readAt === null && markRead.mutate({ ids: [n.id] })} />
        </Panel>
      )}
      {list.hasNextPage && (
        <Button variant="outline" size="sm" className="w-fit" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </Page>
  );
}
