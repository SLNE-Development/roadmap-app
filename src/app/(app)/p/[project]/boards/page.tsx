import { notFound, redirect } from "next/navigation";
import { getProject } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** Opens the first board of the project. */
export default async function BoardsIndex({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const detail = await pageData((db, actor) => getProject(db, actor, slug));
  const first = detail.boards[0];
  if (!first) notFound();
  redirect(`/p/${slug}/boards/${first.slug}`);
}
