"use client";

import { useInfiniteQuery, useSuspenseQueries } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { changeItems, Timeline, updateItems, type TimelineItem } from "@/components/activity/timeline";
import { SegmentedLinks, withQuery } from "@/components/activity/url-tabs";
import { FilterChip, ToggleChip } from "@/components/filter-chip";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { SaveViewButton } from "@/components/save-view-button";
import { Button } from "@/components/ui/button";
import type { ColumnCategory } from "@/db/schema";
import { ACTIVITY_GROUP_KEYS, nextActivityCursor, type ActivityGroup } from "@/lib/activity-groups";
import { activeChips, suggestViewName } from "@/lib/view-name";
import { useTRPC } from "@/trpc/client";

/** The kind filter of the activity page: only updates or only changes. */
export type ActivityKind = "updates" | "changes";

/** The kinds of the segmented control. */
const KINDS = [
  { value: null, key: "all" },
  { value: "updates", key: "updates" },
  { value: "changes", key: "changes" },
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
 * @param props.person only entries by this user id
 * @param props.legacyPerson a person name from an old link, matched on the author's name in the browser
 * @param props.system the slug of a known system to scope to, validated by the page
 * @param props.agents only entries made by agents, or none of them
 * @param props.groups only changes of these entity groups; progress updates are left out
 * @param props.limit how many entries one page holds
 */
export function ActivityView({
  slug,
  kind,
  person,
  legacyPerson,
  system: systemSlug,
  agents,
  groups,
  limit,
}: {
  slug: string;
  kind: ActivityKind | undefined;
  person: string | undefined;
  legacyPerson: string | undefined;
  system: string | undefined;
  agents: "only" | "exclude" | undefined;
  groups: ActivityGroup[];
  limit: number;
}) {
  const t = useTranslations("activity");
  const tc = useTranslations("common");
  const changeT = useTranslations("activity.change");
  const enumsT = useTranslations("enums");
  const trpc = useTRPC();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const filter = { system: systemSlug, person, agents, limit };
  // Progress updates belong to no entity group, so groups narrow the changes only.
  const showUpdates = kind !== "changes";
  const [{ data: detail }, { data: systems }, { data: members }, { data: releases }] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
      trpc.members.list.queryOptions({ project: slug }),
      trpc.releases.list.queryOptions({ project: slug }),
    ],
  });
  const updatePages = useInfiniteQuery({
    ...trpc.history.updates.infiniteQueryOptions({ project: slug, filter }, { getNextPageParam: (page) => nextActivityCursor(page, limit) }),
    enabled: showUpdates,
  });
  const updates = updatePages.data?.pages.flat() ?? [];
  const changePages = useInfiniteQuery({
    ...trpc.history.activity.infiniteQueryOptions(
      { project: slug, filter: { ...filter, groups: groups.length ? groups : undefined } },
      { getNextPageParam: (page) => nextActivityCursor(page, limit) },
    ),
    enabled: kind !== "updates",
  });
  const changes = changePages.data?.pages.flat() ?? [];
  const system = systems.find((s) => s.slug === systemSlug);

  const systemsById = new Map(systems.map((s) => [s.id, { slug: s.slug, title: s.title }]));
  const columns = new Map<string, ColumnCategory>(detail.boards.flatMap((b) => b.columns.map((c) => [`${b.name} / ${c.name}`, c.category] as const)));
  const all: TimelineItem[] = [...updateItems(updates.map(iso)), ...changeItems(changes.map(iso), systemsById, columns, new Map(releases.map((r) => [r.id, r.name])), { t: changeT, te: enumsT })];
  // Items older than the oldest loaded item of a stream that has more would leave a gap there, so they wait.
  const oldest = [
    ...(changePages.hasNextPage ? [changes.at(-1)?.createdAt.toISOString()] : []),
    ...(updatePages.hasNextPage ? [updates.at(-1)?.createdAt.toISOString()] : []),
  ].reduce<string | undefined>((a, b) => (b && (!a || b > a) ? b : a), undefined);
  const hasOlder = Boolean(changePages.hasNextPage || updatePages.hasNextPage);
  const loadingOlder = changePages.isFetchingNextPage || updatePages.isFetchingNextPage;
  const loadOlder = () => {
    if (changePages.hasNextPage) void changePages.fetchNextPage();
    if (updatePages.hasNextPage) void updatePages.fetchNextPage();
  };
  const items = all
    .filter((i) => (!legacyPerson || i.authorName === legacyPerson) && (!oldest || i.createdAt >= oldest))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const agentOptions = [
    { value: "only", label: t("filters.agentsOnly") },
    { value: "exclude", label: t("filters.noAgents") },
  ];
  const path = `/p/${slug}/activity`;
  const personValue = person ?? legacyPerson;
  const query = { kind, person: personValue, system: system?.slug, agents, groups: groups.join(",") || undefined };
  const exportQuery = new URLSearchParams(
    Object.entries({ person, agents, groups: query.groups, system: system?.slug }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const filtered = Boolean(personValue || system || agents || groups.length);
  /** Replaces the URL with the current query changed by `patch`. */
  const go = (patch: Record<string, string | null>) => startTransition(() => router.replace(withQuery(path, query, patch), { scroll: false }));
  const toggleGroup = (g: ActivityGroup, on: boolean) =>
    go({ groups: ACTIVITY_GROUP_KEYS.filter((k) => (k === g ? on : groups.includes(k))).join(",") || null });

  return (
    <Page width="narrow">
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title={t("title")} />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedLinks
          label={t("filters.kind")}
          items={KINDS.map((k) => ({ label: t(`filters.kinds.${k.key}`), href: withQuery(path, query, { kind: k.value }), active: (kind ?? null) === k.value }))}
        />
        <FilterChip
          label={t("filters.person")}
          value={personValue ?? ""}
          onChange={(v) => go({ person: v || null })}
          options={[
            ...members.map((m) => ({ value: m.userId, label: m.name })),
            ...(legacyPerson ? [{ value: legacyPerson, label: legacyPerson }] : []),
          ]}
        />
        <FilterChip
          label={t("filters.system")}
          value={system?.slug ?? ""}
          onChange={(v) => go({ system: v || null })}
          options={systems.map((s) => ({ value: s.slug, label: s.title }))}
        />
        <FilterChip label={t("filters.agents")} value={agents ?? ""} onChange={(v) => go({ agents: v || null })} options={agentOptions} />
        {ACTIVITY_GROUP_KEYS.map((g) => (
          <ToggleChip key={g} label={t(`groups.${g}`)} on={groups.includes(g)} onChange={(on) => toggleGroup(g, on)} />
        ))}
        <Button asChild variant="outline" size="sm">
          <a href={`/api/projects/${slug}/activity/csv${exportQuery ? `?${exportQuery}` : ""}`} download>
            {t("filters.exportCsv")}
          </a>
        </Button>
        {filtered && (
          <SaveViewButton
            path={path}
            query={new URLSearchParams(Object.entries(query).filter((e): e is [string, string] => Boolean(e[1]))).toString()}
            suggestedName={suggestViewName(t("title"), [
              ...activeChips(
                [
                  { key: "person", label: t("filters.person"), options: members.map((m) => ({ value: m.userId, label: m.name })) },
                  { key: "system", label: t("filters.system"), options: systems.map((s) => ({ value: s.slug, label: s.title })) },
                  { key: "agents", label: t("filters.agents"), options: agentOptions },
                ],
                query,
              ),
              ...groups.map((g) => t(`groups.${g}`)),
            ])}
          />
        )}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Activity />}
          title={filtered ? t("empty.filteredTitle") : t("empty.title")}
          description={filtered ? t("empty.filteredDescription") : t("empty.description")}
          action={
            filtered && (
              <Button asChild variant="outline" size="sm">
                <Link href={withQuery(path, { kind }, {})}>{t("filters.clear")}</Link>
              </Button>
            )
          }
        />
      ) : (
        <Timeline items={items} projectSlug={slug} />
      )}
      {hasOlder && (
        <Button variant="outline" size="sm" className="self-center" disabled={loadingOlder} onClick={loadOlder}>
          {loadingOlder ? tc("loading") : t("loadOlder")}
        </Button>
      )}
    </Page>
  );
}
