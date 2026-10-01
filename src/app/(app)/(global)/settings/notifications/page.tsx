import { pushConfig } from "@/lib/push-config";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { NotificationsSettingsView } from "./notifications-settings-view";

/** Page where users choose which notifications reach their inbox and as pushes. */
export default async function NotificationSettingsPage() {
  const pushEnabled = pushConfig() !== null;
  await prefetch(trpc.notifications.rules.queryOptions());
  return (
    <HydrateClient>
      <NotificationsSettingsView pushEnabled={pushEnabled} />
    </HydrateClient>
  );
}
