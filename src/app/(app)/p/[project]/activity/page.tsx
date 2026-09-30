import { Activity } from "lucide-react";
import Link from "next/link";
import { splitAuthor } from "@/components/activity/change-sentence";
import { FilterChip, ToggleChip } from "@/components/activity/filter-chip";
import { changeItems, Timeline, updateItems, type TimelineItem } from "@/components/activity/timeline";
import { SegmentedLinks, withQuery } from "@/components/activity/url-tabs";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { ColumnCategory } from "@/db/schema";
import { listActivity, type HistoryEntry } from "@/lib/ops/activity";
import { getProject } from "@/lib/ops/projects";
import { listSystems } from "@/lib/ops/systems";
import { listUpdates, type UpdateItem } from "@/lib/ops/updates";
import { pageData, toIso } from "@/lib/page";

/** How many entries the timeline shows at most. */
const LIMIT = 200;

/** The kinds of the segmented control. */
const KINDS = [
  { value: null, label: "All" },
  { value: "updates", label: "Updates" },
  { value: "changes", label: "Changes" },
] as const;

/** Returns a search parameter's single value. */
function one(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The project's activity: progress updates and the change log merged into one
 * timeline grouped by day, filterable by kind, person, system and agents.
 */
export default async function ActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const kind = one(sp.kind) === "updates" || one(sp.kind) === "changes" ? (one(sp.kind) as "updates" | "changes") : undefined;
  const person = one(sp.person);
  const agentsOnly = one(sp.agents) === "1";

  const data = await pageData(async (db, actor) => {
    const [detail, systems] = await Promise.all([getProject(db, actor, slug), listSystems(db, actor, slug)]);
    const system = systems.find((s) => s.slug === one(sp.system));
    const filter = { system: system?.slug, limit: LIMIT };
    const [updates, changes] = await Promise.all([
      kind === "changes" ? ([] as UpdateItem[]) : listUpdates(db, actor, slug, filter),
      kind === "updates" ? ([] as HistoryEntry[]) : listActivity(db, actor, slug, filter),
    ]);
    return { detail, systems, system, updates, changes };
  });

  const systemsById = new Map(data.systems.map((s) => [s.id, { slug: s.slug, title: s.title }]));
  const columns = new Map<string, ColumnCategory>(data.detail.boards.flatMap((b) => b.columns.map((c) => [`${b.name} / ${c.name}`, c.category] as const)));
  const all: TimelineItem[] = [...updateItems(data.updates.map(toIso)), ...changeItems(data.changes.map(toIso), systemsById, columns)];
  const people = [...new Set(all.map((i) => splitAuthor(i.author).name))].sort((a, b) => a.localeCompare(b));
  const items = all
    .filter((i) => {
      const who = splitAuthor(i.author);
      return (!person || who.name === person) && (!agentsOnly || who.agent !== null);
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, LIMIT);

  const path = `/p/${slug}/activity`;
  const query = { kind, person, system: data.system?.slug, agents: agentsOnly ? "1" : undefined };
  const filtered = Boolean(person || data.system || agentsOnly);

  return (
    <Page width="narrow">
      <PageHeader crumbs={[{ label: data.detail.project.name, href: `/p/${slug}` }]} title="Activity" />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedLinks
          label="Kind"
          items={KINDS.map((k) => ({ label: k.label, href: withQuery(path, query, { kind: k.value }), active: (kind ?? null) === k.value }))}
        />
        <FilterChip
          label="Person"
          clearHref={withQuery(path, query, { person: null })}
          options={people.map((p) => ({ label: p, href: withQuery(path, query, { person: p }), selected: p === person }))}
        />
        <FilterChip
          label="System"
          clearHref={withQuery(path, query, { system: null })}
          options={data.systems.map((s) => ({ label: s.title, href: withQuery(path, query, { system: s.slug }), selected: s.slug === data.system?.slug }))}
        />
        <ToggleChip label="Agents only" on={agentsOnly} href={withQuery(path, query, { agents: agentsOnly ? null : "1" })} />
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title={filtered ? "Nothing matches these filters" : "No activity yet"}
          description={
            filtered
              ? "Try another person or system, or clear the filters."
              : "Progress updates and every change to systems, tasks and decisions show up here."
          }
          action={
            filtered && (
              <Button asChild variant="outline" size="sm">
                <Link href={withQuery(path, { kind }, {})}>Clear filters</Link>
              </Button>
            )
          }
        />
      ) : (
        <Timeline items={items} projectSlug={slug} />
      )}
    </Page>
  );
}
