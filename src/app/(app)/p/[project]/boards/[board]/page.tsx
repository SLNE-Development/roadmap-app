import { notFound } from "next/navigation";
import { BoardView } from "@/components/board-view";
import { Page } from "@/components/page";
import { getProject } from "@/lib/ops/projects";
import { listMembers } from "@/lib/ops/members";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { listSystems } from "@/lib/ops/systems";
import { latestUpdates } from "@/lib/ops/updates";
import { pageData } from "@/lib/page";

/** One board of the project as a kanban; the sidebar picks the board. */
export default async function BoardPage({ params }: { params: Promise<{ project: string; board: string }> }) {
  const { project: slug, board: boardSlug } = await params;
  const { detail, systems, members, domains, phases, latest } = await pageData(async (db, actor) => {
    const detail = await getProject(db, actor, slug);
    return {
      detail,
      systems: await listSystems(db, actor, slug, { board: boardSlug }),
      members: await listMembers(db, actor, slug),
      domains: await listDomains(db, actor, slug),
      phases: await listPhases(db, actor, slug),
      latest: await latestUpdates(db, detail.project.id),
    };
  });
  const board = detail.boards.find((b) => b.slug === boardSlug);
  if (!board) notFound();
  const canEdit = detail.role !== "viewer";
  const canOwn = detail.role === "owner" || detail.role === "admin";

  return (
    <Page width="full" className="gap-4">
      <BoardView
        projectSlug={slug}
        projectName={detail.project.name}
        board={{ slug: board.slug, name: board.name }}
        boards={detail.boards.map((b) => ({ slug: b.slug, name: b.name }))}
        canEdit={canEdit}
        canOwn={canOwn}
        members={members.map((m) => ({ userId: m.userId, name: m.name }))}
        domains={domains.map((d) => ({ id: d.id, name: d.name }))}
        phases={phases.map((p) => ({ id: p.id, name: p.name }))}
        columns={board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category }))}
        cards={systems.map((s) => ({
          slug: s.slug,
          title: s.title,
          priority: s.priority,
          ownerUserId: s.ownerUserId,
          ownerName: s.ownerName,
          domainId: s.domainId,
          phaseId: s.phaseId,
          columnId: s.columnId,
          planningAreasCovered: s.planningAreasCovered,
          planningRounds: s.planningRounds,
          tasksDone: s.tasksDone,
          tasksTotal: s.tasksTotal,
          latestSummary: latest.get(s.id)?.summary ?? null,
        }))}
      />
    </Page>
  );
}
