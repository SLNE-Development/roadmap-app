import { AppShell } from "@/components/shell/app-shell";
import { listAdrs } from "@/lib/ops/adrs";
import { listMembers } from "@/lib/ops/members";
import { getProject, listProjects } from "@/lib/ops/projects";
import { listQuestions } from "@/lib/ops/questions";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";

/**
 * Shell of every project page: loads the project (404 when invisible) and what
 * its sidebar shows: boards with system counts, section counts and members.
 *
 * @param props.params the route parameters with the project slug
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { actor, detail, projects, systems, adrs, questions, members } = await pageData(async (db, actor) => {
    const detail = await getProject(db, actor, slug);
    const [projects, systems, adrs, questions, members] = await Promise.all([
      listProjects(db, actor),
      listSystems(db, actor, slug),
      listAdrs(db, actor, slug),
      listQuestions(db, actor, slug, { resolved: false }),
      listMembers(db, actor, slug),
    ]);
    return { actor, detail, projects, systems, adrs, questions, members };
  });
  const project = {
    slug,
    name: detail.project.name,
    role: detail.role,
    memberCount: members.length,
    boards: detail.boards.map((b) => ({ slug: b.slug, name: b.name, count: systems.filter((s) => s.boardSlug === b.slug).length })),
    counts: { systems: systems.length, adrs: adrs.length, openQuestions: questions.length },
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
