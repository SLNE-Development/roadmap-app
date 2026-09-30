import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { BoardsSettingsView } from "./boards-view";

/**
 * The project's boards and the column editor of the selected one (`?board=slug`,
 * the first board by default). Owners create boards and edit columns; others read.
 */
export default async function SettingsBoardsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<{ board?: string }>;
}) {
  const { project: slug } = await params;
  const { board: wanted } = await searchParams;
  await prefetch(trpc.projects.get.queryOptions({ project: slug }), trpc.systems.list.queryOptions({ project: slug }));
  return (
    <HydrateClient>
      <BoardsSettingsView slug={slug} wanted={wanted} />
    </HydrateClient>
  );
}
