import { FolderKanban } from "lucide-react";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { EmptyState, Page, PageHeader } from "@/components/page";
import type { ColumnCategory } from "@/db/schema";
import { listActivity } from "@/lib/ops/activity";
import { listProjects } from "@/lib/ops/projects";
import { listQuestions } from "@/lib/ops/questions";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";
import { relativeAge } from "@/lib/time";
import { ProjectGrid, type ProjectCardItem } from "./project-grid";

/** Formats a count with the singular or plural noun: "1 project", "3 projects". */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Start page: the projects the user belongs to with their state, and project creation. */
export default async function HomePage() {
  const projects = await pageData(async (db, actor) => {
    const list = await listProjects(db, actor);
    return Promise.all(
      list.map(async (p): Promise<ProjectCardItem> => {
        const [systems, questions, activity] = await Promise.all([
          listSystems(db, actor, p.slug),
          listQuestions(db, actor, p.slug, { resolved: false }),
          listActivity(db, actor, p.slug, { limit: 1 }),
        ]);
        const byCategory: Partial<Record<ColumnCategory, number>> = {};
        for (const s of systems) byCategory[s.columnCategory] = (byCategory[s.columnCategory] ?? 0) + 1;
        const last = (activity[0]?.createdAt ?? p.createdAt).toISOString();
        return {
          slug: p.slug,
          name: p.name,
          description: p.description,
          role: p.role,
          systems: systems.length,
          blocked: byCategory.blocked ?? 0,
          openQuestions: questions.length,
          byCategory,
          lastActivity: last,
          lastActivityLabel: relativeAge(last),
        };
      }),
    );
  });

  const blocked = projects.reduce((n, p) => n + p.blocked, 0);
  const open = projects.reduce((n, p) => n + p.openQuestions, 0);
  const summary = [
    plural(projects.length, "project", "projects"),
    plural(blocked, "blocked system", "blocked systems"),
    plural(open, "open question", "open questions"),
  ].join(" · ");

  if (projects.length === 0) {
    return (
      <Page>
        <PageHeader title="Projects" actions={<NewProjectDialog />} />
        <EmptyState
          icon={<FolderKanban />}
          title="No projects yet"
          description="Create one, or ask a project owner to add you."
          action={<NewProjectDialog />}
        />
      </Page>
    );
  }

  return (
    <Page>
      <ProjectGrid projects={projects} summary={summary} />
    </Page>
  );
}
