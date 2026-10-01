"use client";

import { useSuspenseQuery } from "@tanstack/react-query";
import { SquareKanban } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useTRPC } from "@/trpc/client";

/**
 * The boards index of a project without boards: an empty state pointing owners
 * to board settings.
 *
 * @param props.slug the project slug
 */
export function BoardsView({ slug }: { slug: string }) {
  const t = useTranslations("board");
  const trpc = useTRPC();
  const { data: detail } = useSuspenseQuery(trpc.projects.get.queryOptions({ project: slug }));
  const canOwn = (detail.role === "owner" || detail.role === "admin") && !detail.project.archivedAt;

  return (
    <Page>
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title={t("crumb")} />
      <EmptyState
        icon={<SquareKanban />}
        title={t("index.emptyTitle")}
        description={
          canOwn ? t("index.emptyOwner") : t("index.emptyViewer")
        }
        action={
          canOwn && (
            <Button asChild>
              <Link href={`/p/${slug}/settings/boards`}>{t("index.newBoard")}</Link>
            </Button>
          )
        }
      />
    </Page>
  );
}
