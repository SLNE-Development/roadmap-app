import { getTranslations } from "next-intl/server";
import { EventDayPanel } from "@/components/events/event-day-panel";
import { Page, PageHeader } from "@/components/page";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

/** The event-day page: open to every signed-in user while the event week runs, and nothing but the event, checklist, fallback plan and check-in. */
export default async function EventDayPage({ params }: { params: Promise<{ request: string }> }) {
  const [{ request }, t] = await Promise.all([params, getTranslations("events.eventDay")]);
  await prefetch(trpc.requests.eventDay.queryOptions({ id: request }));
  return (
    <HydrateClient>
      <Page width="medium">
        <PageHeader title={t("title")} description={t("description")} />
        <EventDayPanel requestId={request} />
      </Page>
    </HydrateClient>
  );
}
