import { ProjectShell } from "@/components/shell/shells";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";

/**
 * Shell of every project page: loads the project (404 when invisible) and what
 * its sidebar shows, using the light `projects.nav` query.
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
  );
  return (
    <HydrateClient>
      <ProjectShell slug={slug}>{children}</ProjectShell>
    </HydrateClient>
  );
}
