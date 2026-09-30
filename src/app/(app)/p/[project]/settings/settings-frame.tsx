"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Page, PageHeader } from "@/components/page";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useTRPC } from "@/trpc/client";

/**
 * The settings header and sub-navigation around the page content. The member
 * and board counts follow every change, since mutations refetch these queries.
 *
 * @param props.slug the project slug
 * @param props.children the settings page
 */
export function SettingsFrame({ slug, children }: { slug: string; children: React.ReactNode }) {
  const trpc = useTRPC();
  const [{ data: detail }, { data: members }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.members.list.queryOptions({ project: slug })],
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
