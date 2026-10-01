import { notFound } from "next/navigation";
import { parseBoardQuery } from "@/lib/url-filters";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { BoardPageView } from "./board-page-view";

/** One board of the project as a kanban; the sidebar picks the board. */
export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; board: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug, board: boardSlug } = await params;
  const query = parseBoardQuery(await searchParams);
  const [detail] = await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug, filter: { board: boardSlug } }),
    trpc.members.list.queryOptions({ project: slug }),
    trpc.structure.domains.queryOptions({ project: slug }),
    trpc.structure.phases.queryOptions({ project: slug }),
    trpc.systems.latestUpdates.queryOptions({ project: slug }),
  );
  const board = detail.boards.find((b) => b.slug === boardSlug);
  if (!board) notFound();
  await prefetch(trpc.prefs.get.queryOptions({ key: `board.collapsed.${board.id}` }));

  return (
    <HydrateClient>
      <BoardPageView slug={slug} boardSlug={boardSlug} query={query} />
    </HydrateClient>
  );
}
