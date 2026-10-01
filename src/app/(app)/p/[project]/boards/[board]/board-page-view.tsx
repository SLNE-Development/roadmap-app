"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { BoardView } from "@/components/board-view";
import { Page } from "@/components/page";
import { normalizeCardFields } from "@/lib/card-fields";
import type { BoardQuery } from "@/lib/url-filters";
import { useTRPC } from "@/trpc/client";

/**
 * The board page body: the kanban of one board with the project's members,
 * domains and phases as filters.
 *
 * @param props.slug the project slug
 * @param props.boardSlug the board slug
 * @param props.query the filters parsed from the URL
 */
export function BoardPageView({ slug, boardSlug, query }: { slug: string; boardSlug: string; query: BoardQuery }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: systems }, { data: members }, { data: domains }, { data: phases }, { data: latest }, { data: customFields }] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug, filter: { board: boardSlug } }),
      trpc.members.list.queryOptions({ project: slug }),
      trpc.structure.domains.queryOptions({ project: slug }),
      trpc.structure.phases.queryOptions({ project: slug }),
      trpc.systems.latestUpdates.queryOptions({ project: slug }),
      trpc.fields.list.queryOptions({ project: slug }),
    ],
  });
  const board = detail.boards.find((b) => b.slug === boardSlug);
  // The page checked the slug; a board deleted meanwhile renders nothing until the route changes.
  if (!board) return null;
  // An archived project is read-only for everyone.
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  const canOwn = (detail.role === "owner" || detail.role === "admin") && !detail.project.archivedAt;

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
          openQuestions: s.openQuestions,
          points: s.points,
          pointsDone: s.pointsDone,
          blockedBy: s.blockedBy,
          fields: s.fields,
          latestSummary: latest.get(s.id)?.summary ?? null,
        }))}
        cardFields={normalizeCardFields(board.cardFields, customFields.map((f) => f.key))}
        customFields={customFields.map((f) => ({ key: f.key, name: f.name }))}
        gatesLanded={systems.some((s) => "gateStatus" in s)}
        query={query}
      />
    </Page>
  );
}
