import { ArchivedProjectBanner } from "@/components/archive-banner";
import { ProjectShell } from "@/components/shell/shells";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

/**
 * Shell of every project page: loads the project (404 when invisible) and what
 * its sidebar shows, using the light `projects.nav` query, with a banner above
 * the page while the project is archived.
 *
 * @param props.params the route parameters with the project slug
 */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  await prefetch(
    trpc.account.me.queryOptions(),
    trpc.projects.list.queryOptions(),
    trpc.projects.get.queryOptions({ project: slug }),
    trpc.projects.nav.queryOptions({ project: slug }),
    trpc.views.list.queryOptions({ project: slug }),
  );
  return (
    <HydrateClient>
      <ProjectShell slug={slug}>
        <ArchivedProjectBanner slug={slug} />
        {children}
      </ProjectShell>
    </HydrateClient>
  );
}
