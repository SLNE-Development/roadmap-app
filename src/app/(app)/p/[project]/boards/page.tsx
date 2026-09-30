import { SquareKanban } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getProject } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** Opens the first board of the project, or says there is none yet. */
export default async function BoardsIndex({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const detail = await pageData((db, actor) => getProject(db, actor, slug));
  const first = detail.boards[0];
  if (first) redirect(`/p/${slug}/boards/${first.slug}`);
  const canOwn = detail.role === "owner" || detail.role === "admin";

  return (
    <Page>
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title="Boards" />
      <EmptyState
        icon={<SquareKanban />}
        title="No boards yet"
        description={
          canOwn ? "Add a board to lay out the systems of this project in columns." : "An owner of this project can add a board."
        }
        action={
          canOwn && (
            <Button asChild>
              <Link href={`/p/${slug}/settings/boards`}>New board</Link>
            </Button>
          )
        }
      />
    </Page>
  );
}
