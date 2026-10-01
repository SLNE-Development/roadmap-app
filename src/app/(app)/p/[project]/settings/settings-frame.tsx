"use client";

import { useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Page, PageHeader } from "@/components/page";
import { SettingsNav } from "@/components/settings/settings-nav";
import { useTRPC } from "@/trpc/client";

/**
 * The settings header and sub-navigation around the page content. The member,
 * board, repository and field counts follow every change, since mutations refetch these queries;
 * the repository count loads after the page.
 *
 * @param props.slug the project slug
 * @param props.children the settings page
 */
export function SettingsFrame({ slug, children }: { slug: string; children: React.ReactNode }) {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const [{ data: detail }, { data: members }, { data: fields }] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.members.list.queryOptions({ project: slug }),
      trpc.fields.list.queryOptions({ project: slug }),
    ],
  });
  const { data: repos } = useQuery(trpc.github.repos.queryOptions({ project: slug }));
  return (
    <Page width="wide">
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title={t("frame.title")} />
      <div className="grid items-start gap-5 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
        <SettingsNav
          projectSlug={slug}
          memberCount={members.length}
          boardCount={detail.boards.length}
          repoCount={repos ? repos.length : null}
          fieldCount={fields.length}
          canOwn={detail.role === "owner" || detail.role === "admin"}
        />
        <div className="min-w-0">{children}</div>
      </div>
    </Page>
  );
}
