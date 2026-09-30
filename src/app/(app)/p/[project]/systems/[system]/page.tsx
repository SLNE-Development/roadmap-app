import { Check, Lock } from "lucide-react";
import { DocumentSection, SpecPreview } from "@/components/document-section";
import { PriorityTag } from "@/components/chips";
import { Page, PageHeader } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { PlanningRounds } from "@/components/planning-rounds";
import { SystemNotes } from "@/components/system-editor";
import { ActivityFeed } from "@/components/system/activity-feed";
import type { SystemControlsData } from "@/components/system/controls";
import { ReopenPlanningButton, SystemActionBar, SystemHeaderActions } from "@/components/system/header-actions";
import { PropertiesPanel, SystemFacts } from "@/components/system/properties";
import { DecisionsPanel, PlanningPanel } from "@/components/system/rail";
import { parseTab, SystemTabs, tabHref } from "@/components/system/tabs";
import { describeGaps } from "@/components/system/text";
import { TaskList } from "@/components/task-list";
import { listActivity } from "@/lib/ops/activity";
import { getDocument } from "@/lib/ops/documents";
import { listMembers } from "@/lib/ops/members";
import { getSystemOverview } from "@/lib/ops/overview";
import { getPlanning } from "@/lib/ops/planning";
import { listDomains, listPhases } from "@/lib/ops/structure";
import { pageData } from "@/lib/page";

/** Parses a version search parameter, returning undefined unless it is a listed version. */
function version(value: string | string[] | undefined, known: number[] | undefined): number | undefined {
  const n = typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : NaN;
  return known?.includes(n) ? n : undefined;
}

/** A thin vertical separator of the meta line. */
function Sep() {
  return (
    <span aria-hidden className="text-border">
      |
    </span>
  );
}

/**
 * One system: crumbs, title with status, primary move and overflow menu, the
 * meta line and summary, then tabs (`?tab=`): Overview (tasks and spec preview
 * with a rail of properties, planning, decisions and notes), Spec, Plan,
 * Planning and Activity. Phones get a 2×2 fact grid, pill tabs and a fixed
 * bottom bar with the status and the primary move.
 */
export default async function SystemPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string; system: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug, system: systemSlug } = await params;
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const data = await pageData(async (db, actor) => {
    const overview = await getSystemOverview(db, actor, slug, systemSlug, 200);
    const specVersion = tab === "spec" ? version(sp.spec, overview.spec?.versions) : undefined;
    const planVersion = tab === "plan" ? version(sp.plan, overview.plan?.versions) : undefined;
    const [spec, plan, planning, history, members, domains, phases] = await Promise.all([
      specVersion ? getDocument(db, actor, slug, systemSlug, "spec", specVersion) : overview.spec,
      planVersion ? getDocument(db, actor, slug, systemSlug, "plan", planVersion) : overview.plan,
      getPlanning(db, actor, slug, systemSlug),
      listActivity(db, actor, slug, { system: systemSlug, limit: 300 }),
      listMembers(db, actor, slug),
      listDomains(db, actor, slug),
      listPhases(db, actor, slug),
    ]);
    return { overview, spec, plan, planning, history, members, domains, phases };
  });
  const { overview: o, planning } = data;
  const canEdit = o.role !== "viewer";
  const base = `/p/${slug}/systems/${systemSlug}`;
  const boardHref = `/p/${slug}/boards/${o.board.slug}`;
  const openQuestions = o.questions.filter((q) => !q.resolved);
  // Update postings are shown as the updates themselves.
  const changes = data.history.filter((h) => h.entity !== "update");

  const controls: SystemControlsData = {
    projectSlug: slug,
    systemSlug,
    canEdit,
    planningComplete: o.planning.complete,
    gaps: o.planning.gaps,
    columnId: o.system.columnId,
    columns: o.board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category })),
    priority: o.system.priority,
    ownerUserId: o.system.ownerUserId,
    ownerName: o.ownerName,
    members: data.members.map((m) => ({ userId: m.userId, name: m.name })),
    domainId: o.system.domainId,
    domains: data.domains.map((d) => ({ id: d.id, name: d.name })),
    phaseId: o.system.phaseId,
    phases: data.phases.map((p) => ({ id: p.id, name: p.name })),
  };

  const meta = {
    spec: o.spec ? `v${o.spec.version}` : undefined,
    plan: o.plan ? `v${o.plan.version}` : undefined,
    planning: `${planning.rounds.length} ${planning.rounds.length === 1 ? "round" : "rounds"}`,
    activity: String(o.updates.length + changes.length),
  };

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: o.project.name, href: `/p/${slug}` }, { label: o.board.name, href: boardHref }, { label: o.system.title }]}
        title={o.system.title}
        actions={<SystemHeaderActions data={controls} />}
      >
        <div className="hidden flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-fg-2 lg:flex">
          <PriorityTag priority={o.system.priority} />
          {o.domain && (
            <>
              <span>{o.domain.name}</span>
              <Sep />
            </>
          )}
          {o.phase && (
            <>
              <span>{o.phase.name}</span>
              <Sep />
            </>
          )}
          {o.ownerName ? <PersonName name={o.ownerName} /> : <span className="text-muted-foreground">No owner</span>}
          <Sep />
          {o.planning.complete ? (
            <span className="flex items-center gap-1.5 font-medium text-cat-done">
              <Check aria-hidden className="size-3.5" strokeWidth={2.4} />
              Planning complete
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-medium text-cat-planning" title={`Still in planning: ${describeGaps(o.planning.gaps)}.`}>
              <Lock aria-hidden className="size-3.5" />
              In planning
            </span>
          )}
        </div>
        <SystemFacts data={controls} planningHref={tabHref(base, "planning")} />
        {o.system.summary && <p className="max-w-[720px] text-[14.5px] leading-[1.55] text-fg-2 lg:text-[15px]">{o.system.summary}</p>}
      </PageHeader>

      <SystemTabs base={base} current={tab} meta={meta} />

      {tab === "overview" && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-5">
            <TaskList
              projectSlug={slug}
              systemSlug={systemSlug}
              tasks={o.tasks}
              members={controls.members}
              canEdit={canEdit}
              planningComplete={o.planning.complete}
              category={o.column.category}
            />
            <SpecPreview doc={o.spec} href={tabHref(base, "spec")} />
          </div>
          <aside aria-label="About this system" className="flex min-w-0 flex-col gap-4">
            <PropertiesPanel
              data={controls}
              boardName={o.board.name}
              boardHref={boardHref}
              domainName={o.domain?.name ?? null}
              phaseName={o.phase?.name ?? null}
            />
            <PlanningPanel planning={planning} href={tabHref(base, "planning")} />
            <DecisionsPanel projectSlug={slug} adrs={o.adrs} questions={openQuestions} />
            <SystemNotes key={o.system.notes} projectSlug={slug} systemSlug={systemSlug} notes={o.system.notes} canEdit={canEdit} />
          </aside>
        </div>
      )}

      {tab === "spec" && (
        <DocumentSection
          title="Specification"
          doc={data.spec}
          param="spec"
          empty={{ title: "No spec yet", description: "The spec is written at the end of the planning interview." }}
        />
      )}

      {tab === "plan" && (
        <DocumentSection
          title="Implementation plan"
          doc={data.plan}
          param="plan"
          empty={{ title: "No plan yet", description: "An agent writes the implementation plan once the spec is agreed; its steps become tasks." }}
        />
      )}

      {tab === "planning" && (
        <div className="flex flex-col gap-4">
          {!o.planning.complete && planning.rounds.length > 0 && (
            <p className="flex items-start gap-2.5 bg-cat-planning-soft px-3 py-2.5 text-[13px] leading-[1.45] text-cat-planning">
              <Lock aria-hidden className="mt-0.5 size-[15px] shrink-0" />
              Still in planning: {describeGaps(o.planning.gaps)}.
            </p>
          )}
          {canEdit && o.planning.complete && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex flex-1 items-center gap-1.5 text-[13px] font-medium text-cat-done">
                <Check aria-hidden className="size-3.5" strokeWidth={2.4} />
                Planning complete
              </p>
              <ReopenPlanningButton projectSlug={slug} systemSlug={systemSlug} />
            </div>
          )}
          <PlanningRounds rounds={planning.rounds} confirmation={planning.confirmation} completedAt={planning.completedAt?.toISOString() ?? null} />
        </div>
      )}

      {tab === "activity" && (
        <ActivityFeed
          updates={o.updates}
          changes={changes}
          names={{
            tasks: new Map(o.tasks.map((t) => [String(t.id), t.title])),
            domains: new Map(data.domains.map((d) => [d.id, d.name])),
            phases: new Map(data.phases.map((p) => [p.id, p.name])),
          }}
        />
      )}

      {canEdit && <div aria-hidden className="h-16 lg:hidden" />}
      <SystemActionBar data={controls} />
    </Page>
  );
}
