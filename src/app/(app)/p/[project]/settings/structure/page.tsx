import { StructureManager } from "@/components/structure-manager";
import { getProject } from "@/lib/ops/projects";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";

/** Domains and phases of the project; editors and above add and delete them. */
export default async function SettingsStructurePage({ params }: { params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const data = await pageData(async (db, actor) => {
    const [detail, domains, phases, systems] = await Promise.all([
      getProject(db, actor, slug),
      listDomains(db, actor, slug),
      listPhases(db, actor, slug),
      listSystems(db, actor, slug),
    ]);
    return { role: detail.role, domains, phases, systems };
  });
  return (
    <StructureManager
      projectSlug={slug}
      canEdit={data.role !== "viewer"}
      domains={data.domains.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description,
        systemCount: data.systems.filter((s) => s.domainId === d.id).length,
      }))}
      phases={data.phases.map((p) => ({ id: p.id, name: p.name, goal: p.goal, dependsOn: p.dependsOn }))}
    />
  );
}
