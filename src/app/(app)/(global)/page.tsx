import Link from "next/link";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { listProjects } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/** Start page: the projects the user belongs to, and project creation. */
export default async function HomePage() {
  const projects = await pageData((db, actor) => listProjects(db, actor));
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 py-6">
      <PageHeader eyebrow="Projects" title="Your projects" actions={<NewProjectDialog />} />
      {projects.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No projects yet</EmptyTitle>
            <EmptyDescription>Create one, or ask a project owner to add you.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewProjectDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.slug}`} className="block h-full">
                <Card className="h-full transition-colors hover:border-primary">
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between gap-2">
                      {p.name}
                      <Badge variant="secondary">{p.role}</Badge>
                    </CardTitle>
                    <CardDescription>{p.description || p.slug}</CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
