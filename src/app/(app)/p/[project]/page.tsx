import Link from "next/link";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { PageHeader } from "@/components/page-header";
import { SystemCard } from "@/components/system-card";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COLUMN_CATEGORIES, PRIORITIES } from "@/db/schema";
import { listMembers } from "@/lib/ops/members";
import { getProject } from "@/lib/ops/projects";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { listSystems, systemFilter } from "@/lib/ops/systems";
import { latestUpdates } from "@/lib/ops/updates";
import { pageData } from "@/lib/page";

/** Reads one string search parameter, or an empty string. */
function param(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Catalogue of a project's systems grouped by domain, filterable by board, phase,
 * column category, priority and owner.
 */
export default async function CataloguePage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const raw = { board: param(sp.board), domain: param(sp.domain), phase: param(sp.phase), category: param(sp.category), priority: param(sp.priority), owner: param(sp.owner) };
  const filter = systemFilter.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => v)));
  const data = await pageData(async (db, actor) => {
    const detail = await getProject(db, actor, slug);
    return {
      detail,
      systems: await listSystems(db, actor, slug, filter.success ? filter.data : {}),
      domains: await listDomains(db, actor, slug),
      phases: await listPhases(db, actor, slug),
      members: await listMembers(db, actor, slug),
      latest: await latestUpdates(db, detail.project.id),
    };
  });
  const canEdit = data.detail.role !== "viewer";
  const groups = [
    ...data.domains.map((d) => ({ key: d.id, name: d.name, description: d.description, items: data.systems.filter((s) => s.domainId === d.id) })),
    { key: "none", name: "No domain", description: "", items: data.systems.filter((s) => !s.domainId) },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Catalogue"
        title={data.detail.project.name}
        description={data.detail.project.description}
        actions={canEdit && <NewSystemDialog projectSlug={slug} boards={data.detail.boards.map((b) => ({ slug: b.slug, name: b.name }))} />}
      />
      <form className="flex flex-wrap items-end gap-2" method="get">
        <NativeSelect name="board" defaultValue={raw.board} aria-label="Board">
          <NativeSelectOption value="">All boards</NativeSelectOption>
          {data.detail.boards.map((b) => (
            <NativeSelectOption key={b.id} value={b.slug}>
              {b.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="domain" defaultValue={raw.domain} aria-label="Domain">
          <NativeSelectOption value="">All domains</NativeSelectOption>
          {data.domains.map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {d.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="phase" defaultValue={raw.phase} aria-label="Phase">
          <NativeSelectOption value="">All phases</NativeSelectOption>
          {data.phases.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="category" defaultValue={raw.category} aria-label="Column category">
          <NativeSelectOption value="">Any column</NativeSelectOption>
          {COLUMN_CATEGORIES.map((c) => (
            <NativeSelectOption key={c} value={c}>
              {c}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="priority" defaultValue={raw.priority} aria-label="Priority">
          <NativeSelectOption value="">Any priority</NativeSelectOption>
          {PRIORITIES.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {p}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect name="owner" defaultValue={raw.owner} aria-label="Owner">
          <NativeSelectOption value="">Any owner</NativeSelectOption>
          <NativeSelectOption value="none">Unowned</NativeSelectOption>
          {data.members.map((m) => (
            <NativeSelectOption key={m.userId} value={m.userId}>
              {m.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        <Button variant="ghost" asChild>
          <Link href={`/p/${slug}`}>Reset</Link>
        </Button>
      </form>
      {groups.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No systems</EmptyTitle>
            <EmptyDescription>Nothing matches these filters, or the project has no systems yet.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-2">
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">{g.name}</h2>
              <span className="text-sm text-muted-foreground">{g.description}</span>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((s) => {
                const latest = data.latest.get(s.id);
                return (
                  <li key={s.id}>
                    <SystemCard
                      system={s}
                      projectSlug={slug}
                      latest={latest && { summary: latest.summary, createdAt: latest.createdAt.toISOString() }}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
