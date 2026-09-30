import Link from "next/link";
import { DocumentSection } from "@/components/document-section";
import { HistoryList } from "@/components/history-list";
import { Markdown } from "@/components/markdown";
import { PlanningRounds } from "@/components/planning-rounds";
import { SystemEditor } from "@/components/system-editor";
import { TaskList } from "@/components/task-list";
import { UpdateList } from "@/components/update-list";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listActivity } from "@/lib/ops/activity";
import { formatAdrNumber } from "@/lib/ops/adrs";
import { getDocument } from "@/lib/ops/documents";
import { listMembers } from "@/lib/ops/members";
import { getSystemOverview } from "@/lib/ops/overview";
import { getPlanning } from "@/lib/ops/planning";
import { listUpdates } from "@/lib/ops/updates";
import { pageData, toIso } from "@/lib/page";

/** Parses a version search parameter, returning undefined unless it is a listed version. */
function version(value: string | string[] | undefined, known: number[] | undefined): number | undefined {
  const n = typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : NaN;
  return known?.includes(n) ? n : undefined;
}

/**
 * One system: header, spec and plan (with version pickers), open questions, the
 * task list, then Planning, Agent updates and History in accordions that start closed.
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
  const data = await pageData(async (db, actor) => {
    const overview = await getSystemOverview(db, actor, slug, systemSlug);
    const specVersion = version(sp.spec, overview.spec?.versions);
    const planVersion = version(sp.plan, overview.plan?.versions);
    return {
      overview,
      spec: specVersion ? await getDocument(db, actor, slug, systemSlug, "spec", specVersion) : overview.spec,
      plan: planVersion ? await getDocument(db, actor, slug, systemSlug, "plan", planVersion) : overview.plan,
      planning: await getPlanning(db, actor, slug, systemSlug),
      updates: await listUpdates(db, actor, slug, { system: systemSlug, limit: 200 }),
      history: await listActivity(db, actor, slug, { system: systemSlug, limit: 300 }),
      members: await listMembers(db, actor, slug),
    };
  });
  const { overview: o } = data;
  const canEdit = o.role !== "viewer";
  const members = data.members.map((m) => ({ userId: m.userId, name: m.name }));
  const openQuestions = o.questions.filter((q) => !q.resolved);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/p/${slug}`} className="text-sm text-muted-foreground hover:underline">
          ← Catalogue
        </Link>
        <p className="mt-3 text-sm text-muted-foreground">
          {[o.domain?.name, o.phase?.name, o.board.name].filter(Boolean).join(" · ")}
        </p>
        <h1 className="text-2xl font-semibold">{o.system.title}</h1>
        {o.system.summary && <p className="mt-1 max-w-3xl text-muted-foreground">{o.system.summary}</p>}
        {o.adrs.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {o.adrs.map((a) => (
              <Badge key={a.number} variant="outline" asChild>
                <Link href={`/p/${slug}/adrs/${a.number}`}>
                  ADR {formatAdrNumber(a.number)}: {a.title}
                </Link>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {!o.planning.complete && (
            <Alert>
              <AlertTitle>Planning is not complete</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {o.planning.gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <DocumentSection title="Specification" doc={data.spec} param="spec" empty="No spec yet. It is written at the end of the planning interview." />
          {data.plan && <DocumentSection title="Implementation plan" doc={data.plan} param="plan" empty="" />}
          {openQuestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Open questions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {openQuestions.map((q) => (
                    <li key={q.id}>
                      <span className="font-medium">{q.title}</span>
                      {q.text && <Markdown className="text-muted-foreground">{q.text}</Markdown>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <TaskList
            projectSlug={slug}
            systemSlug={systemSlug}
            tasks={o.tasks}
            members={members}
            canEdit={canEdit}
            planningComplete={o.planning.complete}
          />

          <Accordion type="multiple" className="rounded-lg border px-4">
            <AccordionItem value="planning">
              <AccordionTrigger>
                Planning ({data.planning.rounds.reduce((n, r) => n + r.items.length, 0)})
              </AccordionTrigger>
              <AccordionContent>
                <PlanningRounds rounds={data.planning.rounds} confirmation={data.planning.confirmation} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="updates">
              <AccordionTrigger>Agent updates ({data.updates.length})</AccordionTrigger>
              <AccordionContent>
                <UpdateList updates={data.updates.map(toIso)} projectSlug={slug} />
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="history">
              <AccordionTrigger>History ({data.history.length})</AccordionTrigger>
              <AccordionContent>
                <HistoryList entries={data.history.map(toIso)} showEntity />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
        <aside className="flex flex-col gap-4">
          <SystemEditor
            key={`${o.system.columnId}-${o.system.priority}-${o.system.ownerUserId}-${o.system.notes}`}
            projectSlug={slug}
            systemSlug={systemSlug}
            columnId={o.system.columnId}
            columns={o.board.columns.map((c) => ({ id: c.id, name: c.name, category: c.category }))}
            planningComplete={o.planning.complete}
            priority={o.system.priority}
            ownerUserId={o.system.ownerUserId}
            notes={o.system.notes}
            members={members}
            canEdit={canEdit}
          />
        </aside>
      </div>
    </div>
  );
}
