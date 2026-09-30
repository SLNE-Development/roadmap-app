import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { SettingsGeneralView } from "./general-view";

/** General project settings and the danger zone; owners edit, everyone else reads. */
export default async function SettingsGeneralPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(trpc.projects.get.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <SettingsGeneralView slug={slug} />
    </HydrateClient>
  );
}
