import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { GlossaryView } from "./glossary-view";

/** The project's glossary; editors add, edit and delete terms, others read. */
export default async function SettingsGlossaryPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(trpc.projects.get.queryOptions({ project: slug }), trpc.glossary.list.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <GlossaryView slug={slug} />
    </HydrateClient>
  );
}
