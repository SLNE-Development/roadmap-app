"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { Boxes } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import type { z } from "zod";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { SystemCard } from "@/components/system-card";
import { BulkBar } from "@/components/systems/bulk-bar";
import { SystemsTable, type SystemGroup } from "@/components/systems/systems-table";
import { SystemsToolbar, type FilterDef } from "@/components/systems/systems-toolbar";
import { Button } from "@/components/ui/button";
import { COLUMN_CATEGORIES, PRIORITIES } from "@/db/schema";
import { priorityKey } from "@/i18n/enums";
import type { SystemListItem, systemFilter } from "@/lib/ops/systems";
import { useTRPC } from "@/trpc/client";

/**
 * The systems list body: toolbar, then the matching systems grouped as a table
 * or card grid.
 *
 * @param props.slug the project slug
 * @param props.current the non-empty URL query values the page reads
 * @param props.filter the server-side filter parsed from `current`
 */
export function SystemsView({
  slug,
  current,
  filter,
}: {
  slug: string;
  current: Record<string, string>;
  filter: z.output<typeof systemFilter>;
}) {
  const t = useTranslations("systems");
  const tCategory = useTranslations("enums.category");
  const tPriority = useTranslations("enums.priority");
  const trpc = useTRPC();
  const [{ data: detail }, { data: systems }, { data: all }, { data: domains }, { data: phases }, { data: members }, { data: latest }, { data: fields }, { data: releases }] =
    useSuspenseQueries({
      queries: [
        trpc.projects.get.queryOptions({ project: slug }),
        trpc.systems.list.queryOptions({ project: slug, filter }),
        trpc.systems.list.queryOptions({ project: slug, filter: { archived: "include" } }),
        trpc.structure.domains.queryOptions({ project: slug }),
        trpc.structure.phases.queryOptions({ project: slug }),
        trpc.members.list.queryOptions({ project: slug }),
        trpc.systems.latestUpdates.queryOptions({ project: slug }),
        trpc.fields.list.queryOptions({ project: slug }),
        trpc.releases.list.queryOptions({ project: slug }),
      ],
    });
  const data = { detail, systems, total: all.length, domains, phases, members, latest, fields };
  const q = current.q ?? "";
  const canEdit = data.detail.role !== "viewer" && !data.detail.project.archivedAt;
  const needle = q.toLowerCase();
  const [selection, setSelection] = useState<{ key: string; slugs: ReadonlySet<string> }>({ key: "", slugs: new Set() });
  const shown = needle
    ? data.systems.filter((s) => s.title.toLowerCase().includes(needle) || s.summary.toLowerCase().includes(needle))
    : data.systems;

  // The selection belongs to one set of filters: drop it when they change (adjusting state while rendering).
  const filterKey = JSON.stringify(current);
  if (selection.key !== filterKey) setSelection({ key: filterKey, slugs: new Set() });
  const picked = shown.filter((s) => selection.slugs.has(s.slug)).map((s) => s.slug);
  const select = (slugs: Iterable<string>) => setSelection({ key: filterKey, slugs: new Set(slugs) });

  const filters: FilterDef[] = [
    { key: "board", label: t("filter.board"), options: data.detail.boards.map((b) => ({ value: b.slug, label: b.name })) },
    { key: "domain", label: t("filter.domain"), options: data.domains.map((d) => ({ value: d.id, label: d.name })) },
    { key: "phase", label: t("filter.phase"), options: data.phases.map((p) => ({ value: p.id, label: p.name })) },
    { key: "category", label: t("filter.status"), options: COLUMN_CATEGORIES.map((c) => ({ value: c, label: tCategory(c) })) },
    { key: "priority", label: t("filter.priority"), options: PRIORITIES.map((p) => ({ value: p, label: tPriority(priorityKey(p)) })) },
    {
      key: "owner",
      label: t("filter.owner"),
      options: [{ value: "none", label: t("filter.unowned") }, ...data.members.map((m) => ({ value: m.userId, label: m.name }))],
    },
    { key: "release", label: t("filter.release"), options: releases.map((r) => ({ value: r.slug, label: r.name })) },
    {
      key: "archived",
      label: t("filter.archived"),
      options: [
        { value: "include", label: t("filter.includeArchived") },
        { value: "only", label: t("filter.onlyArchived") },
      ],
    },
  ].filter((f) => f.options.length > 0);

  const groupBy = current.group ?? "domain";
  const byKey = (list: { id: string; name: string }[], key: (s: SystemListItem) => string | null, none: string): SystemGroup[] =>
    [
      ...list.map((x) => ({ key: x.id, name: x.name, items: shown.filter((s) => key(s) === x.id) })),
      { key: "none", name: none, items: shown.filter((s) => !key(s) || !list.some((x) => x.id === key(s))) },
    ].filter((g) => g.items.length > 0);
  const groups: SystemGroup[] =
    groupBy === "none"
      ? [{ key: "all", name: "", items: shown }]
      : groupBy === "phase"
        ? byKey(data.phases, (s) => s.phaseId, t("group.noPhase"))
        : groupBy === "board"
          ? byKey(
              data.detail.boards.map((b) => ({ id: b.slug, name: b.name })),
              (s) => s.boardSlug,
              t("group.otherBoards"),
            )
          : byKey(data.domains, (s) => s.domainId, t("group.noDomain"));

  const phaseName = Object.fromEntries(data.phases.map((p) => [p.id, p.name]));
  const domainName = new Map(data.domains.map((d) => [d.id, d.name]));
  const updatedAt = Object.fromEntries([...data.latest].map(([id, u]) => [id, u.createdAt.toISOString()]));
  const newSystem = canEdit && data.detail.boards.length > 0 && (
    <NewSystemDialog projectSlug={slug} boards={data.detail.boards.map((b) => ({ slug: b.slug, name: b.name }))} />
  );

  return (
    <Page width="full">
      <PageHeader crumbs={[{ label: data.detail.project.name, href: `/p/${slug}` }]} title={t("title")} actions={newSystem}>
        {data.total > 0 && <SystemsToolbar filters={filters} current={current} shown={shown.length} total={data.total} />}
      </PageHeader>
      {data.total === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={t("empty.title")}
          description={t("empty.description")}
          action={newSystem}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title={t("empty.noMatchTitle")}
          description={t("empty.noMatchDescription")}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/p/${slug}/systems`}>{t("empty.clear")}</Link>
            </Button>
          }
        />
      ) : current.view === "cards" ? (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-2.5" aria-label={g.name || t("title")}>
              {g.name && (
                <div className="flex items-baseline gap-2.5">
                  <h2 className="text-[13px] font-semibold">{g.name}</h2>
                  <span className="text-xs text-muted-foreground">{g.items.length}</span>
                </div>
              )}
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {g.items.map((s) => {
                  const latest = data.latest.get(s.id);
                  return (
                    <li key={s.id}>
                      <SystemCard
                        system={s}
                        projectSlug={slug}
                        domainName={s.domainId ? domainName.get(s.domainId) : null}
                        latest={latest && { summary: latest.summary, createdAt: latest.createdAt.toISOString() }}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <SystemsTable
          groups={groups}
          projectSlug={slug}
          phaseName={phaseName}
          updatedAt={updatedAt}
          fields={data.fields}
          showRelease={releases.length > 0}
          selection={
            canEdit
              ? {
                  selected: selection.slugs,
                  onToggle: (s, checked) => select(checked ? [...picked, s] : picked.filter((p) => p !== s)),
                  onToggleAll: (checked) => select(checked ? shown.map((s) => s.slug) : []),
                }
              : undefined
          }
        />
      )}
      {canEdit && current.view !== "cards" && picked.length > 0 && (
        <BulkBar
          slug={slug}
          systems={picked}
          owners={data.members.map((m) => ({ id: m.userId, name: m.name }))}
          phases={data.phases}
          domains={data.domains}
          boards={data.detail.boards.map((b) => ({ slug: b.slug, name: b.name, columns: b.columns.map((c) => ({ id: c.id, name: c.name })) }))}
          onDone={() => select([])}
          onClear={() => select([])}
        />
      )}
    </Page>
  );
}
