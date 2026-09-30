import { AppShell } from "@/components/shell/app-shell";
import { listProjects } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/**
 * Shell of the pages outside a project (home, API keys, accounts): the sidebar
 * lists the projects instead of a project's sections.
 *
 * @param props.children the page content
 */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const { actor, projects } = await pageData(async (db, actor) => ({ actor, projects: await listProjects(db, actor) }));
  return (
    <AppShell actor={{ name: actor.name, isAdmin: actor.isAdmin }} projects={projects.map((p) => ({ slug: p.slug, name: p.name }))}>
      {children}
    </AppShell>
  );
}
