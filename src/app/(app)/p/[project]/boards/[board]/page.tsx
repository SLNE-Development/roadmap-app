import { notFound } from "next/navigation";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { BoardPageView } from "./board-page-view";

/** One board of the project as a kanban; the sidebar picks the board. */
export default async function BoardPage({ params }: { params: Promise<{ project: string; board: string }> }) {
  const { project: slug, board: boardSlug } = await params;
  const [detail] = await prefetch(
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.systems.list.queryOptions({ project: slug, filter: { board: boardSlug } }),
    trpc.members.list.queryOptions({ project: slug }),
    trpc.structure.domains.queryOptions({ project: slug }),
    trpc.structure.phases.queryOptions({ project: slug }),
    trpc.systems.latestUpdates.queryOptions({ project: slug }),
  );
  if (!detail.boards.some((b) => b.slug === boardSlug)) notFound();

  return (
    <HydrateClient>
      <BoardPageView slug={slug} boardSlug={boardSlug} />
    </HydrateClient>
  );
}
