import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { WebhooksView } from "./webhooks-view";

/** The project's Discord webhooks; only owners see and manage them. */
export default async function SettingsNotificationsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const [detail] = await prefetch(trpc.projects.get.queryOptions({ project: slug }));
  const canOwn = detail.role === "owner" || detail.role === "admin";
  if (!canOwn) {
    return (
      <section className="border bg-card px-4 py-3.5">
        <h2 className="font-display text-[19px] font-semibold">Notifications</h2>
        <p className="mt-1 text-[13.5px] text-muted-foreground">Only owners can manage the project&apos;s Discord webhooks.</p>
      </section>
    );
  }
  await prefetch(trpc.webhooks.list.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <WebhooksView slug={slug} />
    </HydrateClient>
  );
}
