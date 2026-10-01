import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { NotificationsSettingsView } from "./notifications-settings-view";

/** Page where users choose which notifications reach their inbox and as pushes. */
export default async function NotificationSettingsPage() {
  // Task 9 switches this to pushConfig().
  const pushEnabled = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  await prefetch(trpc.notifications.rules.queryOptions());
  return (
    <HydrateClient>
      <NotificationsSettingsView pushEnabled={pushEnabled} />
    </HydrateClient>
  );
}
