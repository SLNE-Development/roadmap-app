"use client";

import { useMutation, useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Check, Lock } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { formatTokens } from "@/components/agents/run-list";
import { ArchivedBanner } from "@/components/archive-banner";
import { PriorityTag } from "@/components/chips";
import { DocumentDiff } from "@/components/document-diff";
import { DocumentSection, SpecPreview } from "@/components/document-section";
import { type StepStates } from "@/components/markdown";
import { Page, PageHeader } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { PlanStepsPanel } from "@/components/plan-steps-panel";
import { CoverageMap } from "@/components/planning/coverage-map";
import { ReopenAreaDialog } from "@/components/planning/reopen-area-dialog";
import { PlanningRounds } from "@/components/planning-rounds";
import { SystemNotes } from "@/components/system-editor";
import { ActivityFeed } from "@/components/system/activity-feed";
import type { SystemControlsData } from "@/components/system/controls";
import { ReopenPlanningButton, SystemActionBar, SystemHeaderActions } from "@/components/system/header-actions";
import { PropertiesPanel, SystemFacts } from "@/components/system/properties";
import { DecisionsPanel, PlanningPanel } from "@/components/system/rail";
import { SystemTabs, tabHref, type SystemTab } from "@/components/system/tabs";
import { AREA_LABEL } from "@/components/system/text";
import type { GlossaryTerm } from "@/lib/glossary-match";
import { stepStates } from "@/lib/plan-steps";
import { plural } from "@/lib/text";
import { formatDate } from "@/lib/time";
import { describeGaps } from "@/components/system/text";
import { TaskList } from "@/components/task-list";
import type { DocumentKind } from "@/db/schema";
import { useTRPC } from "@/trpc/client";

/** A thin vertical separator of the meta line. */
function Sep() {
  return (
    <span aria-hidden className="text-border">
      |
    </span>
  );
}

/** A listed older version of the spec or plan, loaded on its own. */
function VersionedDocument({
  projectSlug,
  systemSlug,
  kind,
  version,
  ...section
}: {
  projectSlug: string;
  systemSlug: string;
  kind: DocumentKind;
  version: number;
  title: string;
  param: string;
  empty: { title: string; description: string };
  stepStates?: StepStates;
  glossary?: GlossaryTerm[];
  aside?: ReactNode;
}) {
  const trpc = useTRPC();
  const { data: doc } = useSuspenseQuery(trpc.history.document.queryOptions({ project: projectSlug, system: systemSlug, kind, version }));
  return <DocumentSection {...section} doc={doc} />;
}

/** The differences between two versions of the spec or plan, in place of its body. */
function ComparedDocument({
  projectSlug,
  systemSlug,
  kind,
  from,
  to,
  ...section
}: {
  projectSlug: string;
  systemSlug: string;
  kind: DocumentKind;
  from: number;
  to: number;
  title: string;
  param: string;
  empty: { title: string; description: string };
  stepStates?: StepStates;
  glossary?: GlossaryTerm[];
  aside?: ReactNode;
}) {
  const trpc = useTRPC();
  const { data: c } = useSuspenseQuery(trpc.history.compare.queryOptions({ project: projectSlug, system: systemSlug, kind, from, to }));
  return <DocumentSection {...section} doc={c.to} compare={{ from, to, diff: <DocumentDiff hunks={c.hunks} added={c.added} removed={c.removed} from={from} to={to} /> }} />;
}

/**
 * The system page body: header with status, primary move and facts, the tabs
 * and the current tab's content.
 *
 * @param props.tab the open tab
 * @param props.specVersion the listed spec version to show on the Spec tab, the latest when undefined
 * @param props.planVersion the listed plan version to show on the Plan tab, the latest when undefined
 * @param props.specCompare the versions to compare on the Spec tab, shown instead of the document when set
 * @param props.planCompare the versions to compare on the Plan tab, shown instead of the document when set
 */
export function SystemView({
  projectSlug: slug,
  systemSlug,
  tab,
  specVersion,
  planVersion,
  specCompare,
  planCompare,
}: {
  projectSlug: string;
  systemSlug: string;
  tab: SystemTab;
  specVersion: number | undefined;
  planVersion: number | undefined;
  specCompare: { from: number; to: number } | undefined;
  planCompare: { from: number; to: number } | undefined;
}) {
  const trpc = useTRPC();
  const ref = { project: slug, system: systemSlug };
  const [{ data: o }, { data: planning }, { data: history }, { data: members }, { data: domains }, { data: phases }, { data: systems }, { data: glossary }] = useSuspenseQueries({
    queries: [
      trpc.systems.overview.queryOptions(ref),
      trpc.planning.get.queryOptions(ref),
      trpc.history.activity.queryOptions({ project: slug, filter: { system: systemSlug, limit: 300 } }),
      trpc.members.list.queryOptions({ project: slug }),
      trpc.structure.domains.queryOptions({ project: slug }),
      trpc.structure.phases.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
      trpc.glossary.list.queryOptions({ project: slug }),
    ],
  });
  const { data: agentCost } = useQuery(trpc.agents.systemCost.queryOptions(ref));
  // Editors of an active project may archive or restore; edits also need the system itself active.
  const canArchive = o.role !== "viewer" && !o.project.archivedAt;
  const archived = o.system.archivedAt !== null;
  const canEdit = canArchive && !archived;
  const restore = useMutation(trpc.systems.setArchived.mutationOptions({ onSuccess: () => toast.success("System restored") }));
  const base = `/p/${slug}/systems/${systemSlug}`;
  const boardHref = `/p/${slug}/boards/${o.board.slug}`;
  const openQuestions = o.questions.filter((q) => !q.resolved);
  // Update postings are shown as the updates themselves.
  const changes = history.filter((h) => h.entity !== "update");

  const controls: SystemControlsData = {
    projectSlug: slug,
    systemSlug,
    canEdit,
    archived,
    planningComplete: o.planning.complete,
    gaps: o.planning.gaps,
    columnId: o.system.columnId,
    columns: o.board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category })),
    priority: o.system.priority,
    ownerUserId: o.system.ownerUserId,
    ownerName: o.ownerName,
    members: members.map((m) => ({ userId: m.userId, name: m.name })),
    domainId: o.system.domainId,
    domains: domains.map((d) => ({ id: d.id, name: d.name })),
    phaseId: o.system.phaseId,
    phases: phases.map((p) => ({ id: p.id, name: p.name })),
  };

  const meta = {
    spec: o.spec ? `v${o.spec.version}` : undefined,
    plan: o.plan ? `v${o.plan.version}` : undefined,
    planning: `${planning.rounds.length} ${planning.rounds.length === 1 ? "round" : "rounds"}`,
    activity: String(o.updates.length + changes.length),
  };

  const specSection = {
    title: "Specification",
    param: "spec",
    glossary,
    empty: { title: "No spec yet", description: "The spec is written at the end of the planning interview." },
  };
  const planSection = {
    title: "Implementation plan",
    param: "plan",
    glossary,
    empty: { title: "No plan yet", description: "An agent writes the implementation plan once the spec is agreed; its steps become tasks." },
  };

  const planPanel = (viewingVersion: number | undefined) => (
    <PlanStepsPanel tasks={o.tasks} projectSlug={slug} systemSlug={systemSlug} viewingVersion={viewingVersion} />
  );

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: o.project.name, href: `/p/${slug}` }, { label: o.board.name, href: boardHref }, { label: o.system.title }]}
        title={o.system.title}
        actions={<SystemHeaderActions data={controls} canArchive={canArchive} />}
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
        {agentCost && (
          <Link href={`/p/${slug}/agents`} className="flex w-fit items-baseline gap-2 text-[13px] text-fg-2 hover:text-foreground">
            <span>Agent cost</span>
            <span className="font-semibold text-foreground">
              {formatTokens(agentCost.tokens)} tokens · {plural(agentCost.runs, "run")}
            </span>
          </Link>
        )}
        {o.system.summary && <p className="max-w-[720px] text-[14.5px] leading-[1.55] text-fg-2 lg:text-[15px]">{o.system.summary}</p>}
      </PageHeader>

      {archived && (
        <ArchivedBanner
          message="This system is archived and read-only."
          onRestore={canArchive ? () => restore.mutate({ ...ref, archived: false }) : undefined}
          pending={restore.isPending}
        />
      )}

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
              dependencies={o.dependencies}
              systems={systems}
              fields={o.fields}
            />
            <PlanningPanel planning={planning} href={tabHref(base, "planning")} />
            <DecisionsPanel projectSlug={slug} systemSlug={systemSlug} adrs={o.adrs} questions={openQuestions} />
            <SystemNotes key={systemSlug} projectSlug={slug} systemSlug={systemSlug} notes={o.system.notes} canEdit={canEdit} />
          </aside>
        </div>
      )}

      {tab === "spec" &&
        (specCompare ? (
          <ComparedDocument projectSlug={slug} systemSlug={systemSlug} kind="spec" {...specCompare} {...specSection} />
        ) : specVersion ? (
          <VersionedDocument projectSlug={slug} systemSlug={systemSlug} kind="spec" version={specVersion} {...specSection} />
        ) : (
          <DocumentSection {...specSection} doc={o.spec} />
        ))}

      {tab === "plan" &&
        (planCompare ? (
          <ComparedDocument
            projectSlug={slug}
            systemSlug={systemSlug}
            kind="plan"
            {...planCompare}
            {...planSection}
            stepStates={stepStates(o.tasks)}
            aside={planPanel(planCompare.to !== o.plan?.version ? planCompare.to : undefined)}
          />
        ) : planVersion ? (
          <VersionedDocument
            projectSlug={slug}
            systemSlug={systemSlug}
            kind="plan"
            version={planVersion}
            {...planSection}
            stepStates={stepStates(o.tasks)}
            aside={planPanel(planVersion !== o.plan?.version ? planVersion : undefined)}
          />
        ) : (
          <DocumentSection {...planSection} doc={o.plan} stepStates={stepStates(o.tasks)} aside={planPanel(undefined)} />
        ))}

      {tab === "planning" && (
        <div className="flex flex-col gap-4">
          {!o.planning.complete && planning.rounds.length > 0 && (
            <p className="flex items-start gap-2.5 bg-cat-planning-soft px-3 py-2.5 text-[13px] leading-[1.45] text-cat-planning">
              <Lock aria-hidden className="mt-0.5 size-[15px] shrink-0" />
              Still in planning: {describeGaps(o.planning.gaps)}.
            </p>
          )}
          {!o.planning.complete && o.planning.gaps.length === 0 && (
            <p className="bg-cat-done-soft px-3 py-2.5 text-[13px] leading-[1.45] text-cat-done">
              Ready to complete{planning.warnings.length > 0 && <> · Thin areas: {planning.coverage.filter((c) => c.thin).map((c) => AREA_LABEL[c.area].toLowerCase()).join(", ")}</>}
            </p>
          )}
          {planning.rounds.length > 0 && <CoverageMap coverage={planning.coverage} />}
          {canEdit && o.planning.complete && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex flex-1 items-center gap-1.5 text-[13px] font-medium text-cat-done">
                <Check aria-hidden className="size-3.5" strokeWidth={2.4} />
                Planning complete
              </p>
              <ReopenAreaDialog projectSlug={slug} systemSlug={systemSlug} reopened={planning.reopenedAreas.map((r) => r.area)} />
              <ReopenPlanningButton projectSlug={slug} systemSlug={systemSlug} />
            </div>
          )}
          {planning.reopenedAreas.map((r) => (
            <p key={r.area} className="flex flex-col gap-0.5 bg-cat-planning-soft px-3 py-2.5 text-[13px] leading-[1.45] text-cat-planning">
              <span>
                Area {r.area} reopened {formatDate(r.reopenedAt.toISOString())}: {r.reason}
              </span>
              <span className="text-xs">An agent closes this area with complete_planning_area once its questions are answered.</span>
            </p>
          ))}
          <PlanningRounds rounds={planning.rounds} confirmation={planning.confirmation} completedAt={planning.completedAt?.toISOString() ?? null} />
        </div>
      )}

      {tab === "activity" && (
        <ActivityFeed
          base={base}
          updates={o.updates}
          changes={changes}
          names={{
            tasks: new Map(o.tasks.map((t) => [String(t.id), t.title])),
            domains: new Map(domains.map((d) => [d.id, d.name])),
            phases: new Map(phases.map((p) => [p.id, p.name])),
          }}
        />
      )}

      {canEdit && <div aria-hidden className="h-[calc(5rem+env(safe-area-inset-bottom))] lg:hidden" />}
      <SystemActionBar data={controls} />
    </Page>
  );
}
