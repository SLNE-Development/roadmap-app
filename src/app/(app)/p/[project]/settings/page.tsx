import { ProjectSettings } from "@/components/project-settings";
import { getProject } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** General project settings and the danger zone; owners edit, everyone else reads. */
export default async function SettingsGeneralPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { project, role } = await pageData((db, actor) => getProject(db, actor, slug));
  return (
    <ProjectSettings
      slug={slug}
      name={project.name}
      description={project.description}
      repoUrl={project.repoUrl}
      canEdit={role === "owner" || role === "admin"}
    />
  );
}
