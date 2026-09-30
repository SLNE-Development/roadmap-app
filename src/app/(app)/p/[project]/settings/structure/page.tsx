import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { StructureView } from "./structure-view";

/** Domains and phases of the project; editors and above add, edit, reorder and delete them. */
export default async function SettingsStructurePage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.structure.domains.queryOptions({ project: slug }),
    trpc.structure.phases.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <StructureView slug={slug} />
    </HydrateClient>
  );
}
