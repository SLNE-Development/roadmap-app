import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { FieldsView } from "./fields-view";

/** The project's custom fields; owners add, edit, reorder and delete them, others read. */
export default async function SettingsFieldsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(trpc.projects.get.queryOptions({ project: slug }), trpc.fields.list.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <FieldsView slug={slug} />
    </HydrateClient>
  );
}
