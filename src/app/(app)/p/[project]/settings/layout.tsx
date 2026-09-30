import { Page, PageHeader } from "@/components/page";
import { SettingsNav } from "@/components/settings/settings-nav";
import { listMembers } from "@/lib/ops/members";
import { getProject } from "@/lib/ops/projects";
import { pageData } from "@/lib/page";

/**
 * Frame of the project settings pages: the header and a sub-navigation beside
 * the page content (above it on phones).
 *
 * @param props.params the route parameters with the project slug
 */
export default async function SettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ project: string }> }) {
  const { project: slug } = await params;
  const { detail, members } = await pageData(async (db, actor) => {
    const [detail, members] = await Promise.all([getProject(db, actor, slug), listMembers(db, actor, slug)]);
    return { detail, members };
  });
  return (
    <Page width="wide">
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title="Project settings" />
      <div className="grid items-start gap-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <SettingsNav projectSlug={slug} memberCount={members.length} boardCount={detail.boards.length} />
        <div className="min-w-0">{children}</div>
      </div>
    </Page>
  );
}
