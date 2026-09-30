import { KanbanIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { ColumnEditor } from "@/components/column-editor";
import { NewBoardDialog } from "@/components/new-board-dialog";
import { BoardNameForm } from "@/components/settings/board-name-form";
import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { getProject } from "@/lib/ops/projects";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";
import { cn } from "@/lib/utils";

/** "1 system" or "N systems". */
const systemsLabel = (n: number) => (n === 1 ? "1 system" : `${n} systems`);

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
  const { detail, systems } = await pageData(async (db, actor) => {
    const [detail, systems] = await Promise.all([getProject(db, actor, slug), listSystems(db, actor, slug)]);
    return { detail, systems };
  });
  const canOwn = detail.role === "owner" || detail.role === "admin";
  const boards = detail.boards;

  if (boards.length === 0) {
    return (
      <EmptyState
        icon={<KanbanIcon />}
        title="No boards yet"
        description={canOwn ? "A board is a workstream with its own columns, such as Development or Operations." : "An owner can add the first board."}
        action={canOwn && <NewBoardDialog projectSlug={slug} openIn="settings" trigger={<Button>New board</Button>} />}
      />
    );
  }

  const selected = boards.find((b) => b.slug === wanted) ?? boards[0];
  const countIn = (columnId: string) => systems.filter((s) => s.columnId === columnId).length;
  const columns = selected.columns.map((c) => ({ id: c.id, name: c.name, category: c.category, systemCount: countIn(c.id) }));

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Boards" className="flex flex-col border bg-card">
        {boards.map((b) => {
          const active = b.slug === selected.slug;
          return (
            <Link
              key={b.id}
              href={`/p/${slug}/settings/boards?board=${b.slug}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col gap-0.5 border-b px-4 py-3 transition-colors hover:bg-muted",
                active && "bg-brand-soft text-brand-strong hover:bg-brand-soft",
              )}
            >
              <span className="font-semibold">{b.name}</span>
              <span className="text-xs text-muted-foreground">
                {b.columns.length} columns · {systemsLabel(systems.filter((s) => s.boardSlug === b.slug).length)}
              </span>
            </Link>
          );
        })}
        {canOwn && (
          <NewBoardDialog
            projectSlug={slug}
            openIn="settings"
            trigger={
              <button
                type="button"
                className="flex items-center gap-2 px-4 py-3 text-left text-[13px] font-semibold text-brand-strong outline-none hover:bg-muted focus-visible:bg-muted"
              >
                <PlusIcon className="size-3.5" aria-hidden />
                New board
              </button>
            }
          />
        )}
      </nav>

      <section aria-label={`Board ${selected.name}`} className="flex flex-col gap-3.5 border bg-card p-4 sm:p-[18px]">
        <div className="flex flex-wrap items-end gap-3">
          {canOwn ? (
            <BoardNameForm key={selected.slug} projectSlug={slug} boardSlug={selected.slug} name={selected.name} />
          ) : (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[12.5px] font-semibold text-fg-2">Board</span>
              <h2 className="font-display text-[19px] font-semibold">{selected.name}</h2>
            </div>
          )}
          <Button variant="outline" asChild>
            <Link href={`/p/${slug}/boards/${selected.slug}`}>Open board</Link>
          </Button>
        </div>
        <ColumnEditor
          key={`${selected.slug}:${columns.map((c) => `${c.id}/${c.name}/${c.category}/${c.systemCount}`).join("|")}`}
          projectSlug={slug}
          boardSlug={selected.slug}
          columns={columns}
          canEdit={canOwn}
        />
      </section>
    </div>
  );
}
