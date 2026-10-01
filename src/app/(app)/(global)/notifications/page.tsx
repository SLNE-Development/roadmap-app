import { NotificationsView } from "./notifications-view";

/** The full inbox: every notification, newest first, filtered to unread with `?show=unread`. */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  return <NotificationsView unreadOnly={sp.show === "unread"} />;
}
