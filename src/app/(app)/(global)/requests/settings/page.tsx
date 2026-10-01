import { notFound } from "next/navigation";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { EventSettingsView } from "./event-settings-view";

/** The event settings: channels, webhooks and bot, rulebook, style guides and message templates. Event roles only; everyone else gets a 404. */
export default async function EventSettingsPage() {
  const [me] = await prefetch(trpc.account.me.queryOptions());
  if (!me.isAdmin && !me.isEventManager && !me.isEventDeveloper) notFound();
  await prefetch(trpc.requests.settings.get.queryOptions());
  return (
    <HydrateClient>
      <EventSettingsView />
    </HydrateClient>
  );
}
