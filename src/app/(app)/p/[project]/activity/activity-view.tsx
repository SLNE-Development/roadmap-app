"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { changeItems, Timeline, updateItems, type TimelineItem } from "@/components/activity/timeline";
import { SegmentedLinks, withQuery } from "@/components/activity/url-tabs";
import { FilterChip, ToggleChip } from "@/components/filter-chip";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import type { ColumnCategory } from "@/db/schema";
import { useTRPC } from "@/trpc/client";

/** The kind filter of the activity page: only updates or only changes. */
export type ActivityKind = "updates" | "changes";

/** The kinds of the segmented control. */
const KINDS = [
  { value: null, label: "All" },
  { value: "updates", label: "Updates" },
  { value: "changes", label: "Changes" },
] as const;

/** Returns a copy of `row` with `createdAt` as an ISO string, as the timeline expects. */
function iso<T extends { createdAt: Date }>(row: T): Omit<T, "createdAt"> & { createdAt: string } {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/**
 * The activity page body: the filters and the merged timeline, or an empty
 * state. Lists excluded by `kind` are not queried.
 *
 * @param props.slug the project slug
 * @param props.kind only updates or only changes; both when undefined
 * @param props.person only entries by this person
 * @param props.system the slug of a known system to scope to, validated by the page
 * @param props.agentsOnly only entries made by agents
 * @param props.limit how many entries the timeline shows at most
 */
export function ActivityView({
  slug,
  kind,
  person,
  system: systemSlug,
  agentsOnly,
  limit,
}: {
  slug: string;
  kind: ActivityKind | undefined;
  person: string | undefined;
  system: string | undefined;
  agentsOnly: boolean;
  limit: number;
}) {
  const trpc = useTRPC();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const filter = { system: systemSlug, limit };
  const [{ data: detail }, { data: systems }] = useSuspenseQueries({
    queries: [trpc.projects.get.queryOptions({ project: slug }), trpc.systems.list.queryOptions({ project: slug })],
  });
  const updateQueries = kind === "changes" ? [] : [trpc.history.updates.queryOptions({ project: slug, filter })];
  const changeQueries = kind === "updates" ? [] : [trpc.history.activity.queryOptions({ project: slug, filter })];
  const updates = useSuspenseQueries({ queries: updateQueries })[0]?.data ?? [];
  const changes = useSuspenseQueries({ queries: changeQueries })[0]?.data ?? [];
  const system = systems.find((s) => s.slug === systemSlug);

  const systemsById = new Map(systems.map((s) => [s.id, { slug: s.slug, title: s.title }]));
  const columns = new Map<string, ColumnCategory>(detail.boards.flatMap((b) => b.columns.map((c) => [`${b.name} / ${c.name}`, c.category] as const)));
  const all: TimelineItem[] = [...updateItems(updates.map(iso)), ...changeItems(changes.map(iso), systemsById, columns)];
  const people = [...new Set(all.map((i) => i.authorName))].sort((a, b) => a.localeCompare(b));
  const items = all
    .filter((i) => (!person || i.authorName === person) && (!agentsOnly || i.agent !== null))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  const path = `/p/${slug}/activity`;
  const query = { kind, person, system: system?.slug, agents: agentsOnly ? "1" : undefined };
  const filtered = Boolean(person || system || agentsOnly);
  /** Replaces the URL with the current query changed by `patch`. */
  const go = (patch: Record<string, string | null>) => startTransition(() => router.replace(withQuery(path, query, patch), { scroll: false }));

  return (
    <Page width="narrow">
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title="Activity" />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedLinks
          label="Kind"
          items={KINDS.map((k) => ({ label: k.label, href: withQuery(path, query, { kind: k.value }), active: (kind ?? null) === k.value }))}
        />
        <FilterChip
          label="Person"
          value={person ?? ""}
          onChange={(v) => go({ person: v || null })}
          options={people.map((p) => ({ value: p, label: p }))}
        />
        <FilterChip
          label="System"
          value={system?.slug ?? ""}
          onChange={(v) => go({ system: v || null })}
          options={systems.map((s) => ({ value: s.slug, label: s.title }))}
        />
        <ToggleChip label="Agents only" on={agentsOnly} onChange={(on) => go({ agents: on ? "1" : null })} />
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
