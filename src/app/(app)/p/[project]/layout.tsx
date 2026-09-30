import { ProjectNav } from "@/components/project-nav";
import { getProject, listProjects } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/**
 * Shell of every project page: loads the project (404 when invisible) and shows the project navigation.
 *
 * @param props.params the route parameters with the project slug
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { detail, projects } = await pageData(async (db, actor) => ({
    detail: await getProject(db, actor, slug),
    projects: await listProjects(db, actor),
  }));
  return (
    <>
      <ProjectNav project={{ slug, name: detail.project.name }} projects={projects.map((p) => ({ slug: p.slug, name: p.name }))} />
      <div className="mx-auto max-w-7xl py-6">{children}</div>
    </>
  );
}
