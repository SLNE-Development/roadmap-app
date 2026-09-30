import { FolderKanban } from "lucide-react";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { listProjects } from "@/lib/ops/projects";
import { projectSummaries } from "@/lib/ops/summaries";
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
    const summaries = await projectSummaries(db, list.map((p) => p.id));
    return list.map((p): ProjectCardItem => {
      const s = summaries.get(p.id);
      const last = (s?.lastChange ?? p.createdAt).toISOString();
      return {
        slug: p.slug,
        name: p.name,
        description: p.description,
        role: p.role,
        systems: s?.systems ?? 0,
        blocked: s?.byCategory.blocked ?? 0,
        openQuestions: s?.openQuestions ?? 0,
        byCategory: s?.byCategory ?? {},
        lastActivity: last,
        lastActivityLabel: relativeAge(last),
      };
    });
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
