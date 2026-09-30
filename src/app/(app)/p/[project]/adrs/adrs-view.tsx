"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { ADR_STATUSES, type AdrStatus } from "@/db/schema";
import { formatAdrNumber } from "@/lib/adr-number";
import { formatDate } from "@/lib/time";
import { useTRPC } from "@/trpc/client";
import { AdrList } from "./adr-list";

/** Display names of the status tabs. */
const STATUS_LABEL: Record<AdrStatus, string> = { proposed: "Proposed", accepted: "Accepted", superseded: "Superseded" };

/**
 * The decisions page body: status tabs with counts, the search box and the
 * list, or an empty state explaining how agents record decisions.
 *
 * @param props.slug the project slug
 * @param props.status the status tab from `?status=`, all when undefined
 */
export function AdrsView({ slug, status }: { slug: string; status: AdrStatus | undefined }) {
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
    { label: "All", count: adrs.length, href: path, active: !status },
    ...ADR_STATUSES.map((s) => ({ label: STATUS_LABEL[s], count: adrs.filter((a) => a.status === s).length, href: `${path}?status=${s}`, active: status === s })),
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
        ? `Superseded by ${formatAdrNumber(a.supersededBy)}`
        : a.supersedes
          ? `Supersedes ${formatAdrNumber(a.supersedes)}`
          : null,
      date: formatDate((a.acceptedAt ?? a.createdAt).toISOString()),
    }));

  return (
    <Page width="medium">
      <PageHeader
        crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]}
        title="Decisions"
        description="Architecture decisions, numbered. Accepted ones never change; a new one supersedes them."
      />
      {adrs.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title="No decisions yet"
          description={
            <>
              Agents record the decisions you make with <code className="font-mono">surf-roadmap:new-adr</code>. Proposed ones show up here to accept.
            </>
          }
        />
      ) : (
        <AdrList projectSlug={slug} tabs={tabs} rows={rows} />
      )}
    </Page>
  );
}
