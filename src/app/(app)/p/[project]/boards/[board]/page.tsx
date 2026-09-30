import Link from "next/link";
import { notFound } from "next/navigation";
import { BoardView } from "@/components/board-view";
import { ColumnEditor } from "@/components/column-editor";
import { NewBoardDialog } from "@/components/new-board-dialog";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getProject } from "@/lib/ops/projects";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";

/** One board of the project as a kanban, with tabs for the other boards. */
export default async function BoardPage({ params }: { params: Promise<{ project: string; board: string }> }) {
  const { project: slug, board: boardSlug } = await params;
  const { detail, systems } = await pageData(async (db, actor) => ({
    detail: await getProject(db, actor, slug),
    systems: await listSystems(db, actor, slug, { board: boardSlug }),
  }));
  const board = detail.boards.find((b) => b.slug === boardSlug);
  if (!board) notFound();
  const canEdit = detail.role !== "viewer";
  const canOwn = detail.role === "owner" || detail.role === "admin";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        eyebrow="Boards"
        title={board.name}
        description="Drag a card to another column, or use its menu. Systems leave planning only after their planning interview is complete."
        actions={
          canOwn && (
            <>
              <ColumnEditor projectSlug={slug} boardSlug={board.slug} columns={board.columns} />
              <NewBoardDialog projectSlug={slug} />
            </>
          )
        }
      />
      <Tabs value={board.slug}>
        <TabsList>
          {detail.boards.map((b) => (
            <TabsTrigger key={b.id} value={b.slug} asChild>
              <Link href={`/p/${slug}/boards/${b.slug}`}>{b.name}</Link>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <BoardView
        projectSlug={slug}
        canEdit={canEdit}
        columns={board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category }))}
        cards={systems.map((s) => ({
          slug: s.slug,
          title: s.title,
          priority: s.priority,
          ownerName: s.ownerName,
          columnId: s.columnId,
          planningComplete: s.planningComplete,
        }))}
      />
    </div>
  );
}
