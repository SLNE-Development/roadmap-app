import { PageHeader } from "@/components/page-header";
import { ProjectSettings } from "@/components/project-settings";
import { StructureManager } from "@/components/structure-manager";
import { getProject } from "@/lib/ops/projects";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { pageData } from "@/lib/page";

/** Project settings: fields and deletion for owners, domains and phases for editors. */
export default async function SettingsPage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const data = await pageData(async (db, actor) => ({
    detail: await getProject(db, actor, slug),
    domains: await listDomains(db, actor, slug),
    phases: await listPhases(db, actor, slug),
  }));
  const { project, role } = data.detail;
  const canOwn = role === "owner" || role === "admin";
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader eyebrow="Settings" title={project.name} />
      {role !== "viewer" && <StructureManager projectSlug={slug} domains={data.domains} phases={data.phases} />}
      {canOwn && <ProjectSettings slug={slug} name={project.name} description={project.description} repoUrl={project.repoUrl} />}
      {role === "viewer" && <p className="text-sm text-muted-foreground">Viewers cannot change settings.</p>}
    </div>
  );
}
