import { Scale } from "lucide-react";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { ADR_STATUSES, type AdrStatus } from "@/db/schema";
import { formatAdrNumber, listAdrs } from "@/lib/ops/adrs";
import { getProject } from "@/lib/ops/projects";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";
import { formatDate } from "@/lib/time";
import { AdrList } from "./adr-list";

/** Display names of the status tabs. */
const STATUS_LABEL: Record<AdrStatus, string> = { proposed: "Proposed", accepted: "Accepted", superseded: "Superseded" };

/**
 * The project's decision records, newest first, with status tabs (`?status=`)
 * and a title search. Agents propose decisions over MCP, so there is no create button.
 */
export default async function AdrsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const raw = (await searchParams).status;
  const status = ADR_STATUSES.find((s) => s === raw);
  const { adrs, systems, name } = await pageData(async (db, actor) => {
    const [adrs, systems, detail] = await Promise.all([listAdrs(db, actor, slug), listSystems(db, actor, slug), getProject(db, actor, slug)]);
    return { adrs, systems, name: detail.project.name };
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
        crumbs={[{ label: name, href: `/p/${slug}` }]}
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
