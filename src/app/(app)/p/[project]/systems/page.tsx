import { Boxes } from "lucide-react";
import Link from "next/link";
import { CATEGORY_LABEL } from "@/components/chips";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { SystemCard } from "@/components/system-card";
import { SystemsTable, type SystemGroup } from "@/components/systems/systems-table";
import { SystemsToolbar, type FilterDef } from "@/components/systems/systems-toolbar";
import { Button } from "@/components/ui/button";
import { COLUMN_CATEGORIES, PRIORITIES } from "@/db/schema";
import { listMembers } from "@/lib/ops/members";
import { getProject } from "@/lib/ops/projects";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { listSystems, systemFilter, type SystemListItem } from "@/lib/ops/systems";
import { latestUpdates } from "@/lib/ops/updates";
import { pageData } from "@/lib/page";

/** Query keys the page reads; the filter keys match {@link systemFilter}. */
const KEYS = ["q", "board", "domain", "phase", "category", "priority", "owner", "group", "view"] as const;

/** Reads one string search parameter, or an empty string. */
function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * All systems of a project as a table or card grid, searchable, filterable by
 * board, domain, phase, status, priority and owner, and grouped by domain,
 * phase or board. Every control lives in the URL query.
 */
export default async function SystemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const current = Object.fromEntries(KEYS.map((k) => [k, param(sp[k])]).filter(([, v]) => v)) as Record<string, string>;
  const q = current.q ?? "";
  const filter = systemFilter.safeParse(Object.fromEntries(Object.entries(current).filter(([k]) => !["q", "group", "view"].includes(k))));
  const data = await pageData(async (db, actor) => {
    const detail = await getProject(db, actor, slug);
    const [systems, all, domains, phases, members, latest] = await Promise.all([
      listSystems(db, actor, slug, filter.success ? filter.data : {}),
      listSystems(db, actor, slug),
      listDomains(db, actor, slug),
      listPhases(db, actor, slug),
      listMembers(db, actor, slug),
      latestUpdates(db, detail.project.id),
    ]);
    return { detail, systems, total: all.length, domains, phases, members, latest };
  });
  const canEdit = data.detail.role !== "viewer";
  const needle = q.toLowerCase();
  const shown = needle
    ? data.systems.filter((s) => s.title.toLowerCase().includes(needle) || s.summary.toLowerCase().includes(needle))
    : data.systems;

  const filters: FilterDef[] = [
    { key: "board", label: "Board", options: data.detail.boards.map((b) => ({ value: b.slug, label: b.name })) },
    { key: "domain", label: "Domain", options: data.domains.map((d) => ({ value: d.id, label: d.name })) },
    { key: "phase", label: "Phase", options: data.phases.map((p) => ({ value: p.id, label: p.name })) },
    { key: "category", label: "Status", options: COLUMN_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] })) },
    { key: "priority", label: "Priority", options: PRIORITIES.map((p) => ({ value: p, label: p })) },
    {
      key: "owner",
      label: "Owner",
      options: [{ value: "none", label: "Unowned" }, ...data.members.map((m) => ({ value: m.userId, label: m.name }))],
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
        ? byKey(data.phases, (s) => s.phaseId, "No phase")
        : groupBy === "board"
          ? byKey(
              data.detail.boards.map((b) => ({ id: b.slug, name: b.name })),
              (s) => s.boardSlug,
              "Other boards",
            )
          : byKey(data.domains, (s) => s.domainId, "No domain");

  const phaseName = Object.fromEntries(data.phases.map((p) => [p.id, p.name]));
  const domainName = new Map(data.domains.map((d) => [d.id, d.name]));
  const updatedAt = Object.fromEntries([...data.latest].map(([id, u]) => [id, u.createdAt.toISOString()]));
  const newSystem = canEdit && data.detail.boards.length > 0 && (
    <NewSystemDialog projectSlug={slug} boards={data.detail.boards.map((b) => ({ slug: b.slug, name: b.name }))} />
  );

  return (
    <Page width="full">
      <PageHeader crumbs={[{ label: data.detail.project.name, href: `/p/${slug}` }]} title="Systems" actions={newSystem}>
        {data.total > 0 && <SystemsToolbar filters={filters} current={current} shown={shown.length} total={data.total} />}
      </PageHeader>
      {data.total === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title="No systems yet"
          description="A system is one feature or area of the project. It starts in planning."
          action={newSystem}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title="No systems match"
          description="Try another search or remove a filter."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href={`/p/${slug}/systems`}>Clear filters</Link>
            </Button>
          }
        />
      ) : current.view === "cards" ? (
        <div className="flex flex-col gap-6">
          {groups.map((g) => (
            <section key={g.key} className="flex flex-col gap-2.5" aria-label={g.name || "Systems"}>
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
        <SystemsTable groups={groups} projectSlug={slug} phaseName={phaseName} updatedAt={updatedAt} />
      )}
    </Page>
  );
}
