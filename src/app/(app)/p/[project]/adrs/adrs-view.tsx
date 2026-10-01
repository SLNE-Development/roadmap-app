"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { SegmentedLinks } from "@/components/activity/url-tabs";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { ADR_STATUSES, type AdrStatus } from "@/db/schema";
import { formatAdrNumber } from "@/lib/adr-number";
import { useShortDate } from "@/lib/use-short-date";
import { useTRPC } from "@/trpc/client";
import { AdrList } from "./adr-list";

/**
 * The decisions page body: status tabs with counts, the search box and the
 * list, or an empty state explaining how agents record decisions.
 *
 * @param props.slug the project slug
 * @param props.status the status tab from `?status=`, all when undefined
 */
export function AdrsView({ slug, status }: { slug: string; status: AdrStatus | undefined }) {
  const t = useTranslations("adrs");
  const te = useTranslations("enums.adrStatus");
  const shortDate = useShortDate();
  const trpc = useTRPC();
  const [{ data: adrs }, { data: systems }, { data: detail }] = useSuspenseQueries({
    queries: [
      trpc.adrs.list.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
      trpc.projects.get.queryOptions({ project: slug }),
    ],
  });
  const titles = new Map(systems.map((s) => [s.slug, s.title]));
  const path = `/p/${slug}/adrs`;
  const tabs = [
    { label: t("tabAll"), count: adrs.length, href: path, active: !status },
    ...ADR_STATUSES.map((s) => ({ label: te(s), count: adrs.filter((a) => a.status === s).length, href: `${path}?status=${s}`, active: status === s })),
  ];
  const rows = adrs
    .filter((a) => !status || a.status === status)
    .sort((a, b) => b.number - a.number)
    .map((a) => ({
      number: a.number,
      label: formatAdrNumber(a.number),
      title: a.title,
      status: a.status,
      systems: a.systems.map((s) => titles.get(s) ?? s),
      note: a.supersededBy
        ? t("supersededBy", { number: formatAdrNumber(a.supersededBy) })
        : a.supersedes
          ? t("supersedes", { number: formatAdrNumber(a.supersedes) })
          : null,
      date: shortDate(a.acceptedAt ?? a.createdAt),
    }));

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]}
        title={t("title")}
        description={t("description")}
        actions={
          <SegmentedLinks
            label={t("view.label")}
            items={[
              { label: t("view.list"), href: path, active: true },
              { label: t("view.map"), href: `${path}/map`, active: false },
            ]}
          />
        }
      />
      {adrs.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title={t("emptyTitle")}
          description={t.rich("emptyDescription", { code: (chunks) => <code className="font-mono">{chunks}</code> })}
        />
      ) : (
        <AdrList projectSlug={slug} tabs={tabs} rows={rows} />
      )}
    </Page>
  );
}
