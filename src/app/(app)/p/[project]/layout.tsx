import { AppShell } from "@/components/shell/app-shell";
import { getProject, listProjects } from "@/lib/ops/projects";
import { projectNav } from "@/lib/ops/summaries";
import { pageData } from "@/lib/page";

/**
 * Shell of every project page: loads the project (404 when invisible) and what
 * its sidebar shows: boards with system counts, section counts and members,
 * using the light {@link projectNav} queries.
 *
 * @param props.params the route parameters with the project slug
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { actor, detail, projects, nav } = await pageData(async (db, actor) => {
    const detail = await getProject(db, actor, slug);
    const [projects, nav] = await Promise.all([listProjects(db, actor), projectNav(db, actor, slug)]);
    return { actor, detail, projects, nav };
  });
  const systems = nav.systems;
  const project = {
    slug,
    name: detail.project.name,
    role: detail.role,
    memberCount: nav.memberCount,
    boards: detail.boards.map((b) => ({ slug: b.slug, name: b.name, count: systems.filter((s) => s.boardSlug === b.slug).length })),
    counts: { systems: systems.length, adrs: nav.adrCount, openQuestions: nav.openQuestionCount },
  };
  return (
    <AppShell
      actor={{ name: actor.name, isAdmin: actor.isAdmin }}
      projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}
      project={project}
      systems={systems.map((s) => ({ slug: s.slug, title: s.title }))}
    >
      {children}
    </AppShell>
  );
}
