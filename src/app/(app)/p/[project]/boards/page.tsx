import { redirect } from "next/navigation";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { BoardsView } from "./boards-view";

/** Opens the first board of the project, or says there is none yet. */
export default async function BoardsIndex({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const [detail] = await prefetch(trpc.projects.get.queryOptions({ project: slug }));
  const first = detail.boards[0];
  if (first) redirect(`/p/${slug}/boards/${first.slug}`);

  return (
    <HydrateClient>
      <BoardsView slug={slug} />
    </HydrateClient>
  );
}
