import { CircleHelp } from "lucide-react";
import { FilterChip } from "@/components/activity/filter-chip";
import { UnderlineTabs, withQuery } from "@/components/activity/url-tabs";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { QuestionCard } from "@/components/question-card";
import { AskQuestionDialog } from "@/components/questions/ask-question-dialog";
import { getProject } from "@/lib/ops/projects";
import { listQuestions } from "@/lib/ops/questions";
import { listSystems } from "@/lib/ops/systems";
import { pageData } from "@/lib/page";

/**
 * The project's questions: Open and Resolved tabs (`?tab=`) with counts, a
 * system filter (`?system=`), and for editors an "Ask a question" dialog and
 * answer forms on the cards.
 */
export default async function QuestionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { project: slug } = await params;
  const sp = await searchParams;
  const tab = sp.tab === "resolved" ? "resolved" : "open";
  const { questions, systems, detail } = await pageData(async (db, actor) => {
    const [questions, systems, detail] = await Promise.all([listQuestions(db, actor, slug), listSystems(db, actor, slug), getProject(db, actor, slug)]);
    return { questions, systems, detail };
  });
  const canEdit = detail.role !== "viewer";
  const system = systems.find((s) => s.slug === sp.system);
  const inScope = questions.filter((q) => !system || q.systemSlug === system.slug);
  const open = inScope.filter((q) => !q.resolved);
  const resolved = inScope.filter((q) => q.resolved);
  const shown = tab === "open" ? open : resolved;

  const path = `/p/${slug}/questions`;
  const query = { tab: tab === "resolved" ? "resolved" : undefined, system: system?.slug };
  const withSystems = systems.filter((s) => questions.some((q) => q.systemSlug === s.slug));

  return (
    <Page width="narrow">
      <PageHeader
        crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]}
        title="Questions"
        actions={canEdit && <AskQuestionDialog projectSlug={slug} systems={systems.map((s) => ({ slug: s.slug, title: s.title }))} defaultSystem={system?.slug} />}
      />
      <UnderlineTabs
        label="Questions"
        tabs={[
          { label: "Open", count: open.length, href: withQuery(path, query, { tab: null }), active: tab === "open" },
          { label: "Resolved", count: resolved.length, href: withQuery(path, query, { tab: "resolved" }), active: tab === "resolved" },
        ]}
      >
        <FilterChip
          label="System"
          clearHref={withQuery(path, query, { system: null })}
          options={withSystems.map((s) => ({ label: s.title, href: withQuery(path, query, { system: s.slug }), selected: s.slug === system?.slug }))}
        />
      </UnderlineTabs>
      {shown.length === 0 ? (
        <EmptyState
          icon={<CircleHelp />}
          title={tab === "open" ? "No open questions" : "No resolved questions yet"}
          description={
            tab === "open"
              ? "Questions that need a person's answer collect here, asked by people or by agents while they work."
              : "Answered and resolved questions stay here for reference."
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((q) => (
            <QuestionCard
              key={q.id}
              projectSlug={slug}
              canEdit={canEdit}
              question={{
                id: q.id,
                title: q.title,
                text: q.text,
                answer: q.answer,
                resolved: q.resolved,
                systemSlug: q.systemSlug,
                systemTitle: q.systemTitle,
                authorName: q.authorName,
                agent: q.agent,
                createdAt: q.createdAt.toISOString(),
                answeredBy: q.answeredAt ? { name: q.answeredByName ?? "unknown", agent: q.answeredAgent, at: q.answeredAt.toISOString() } : null,
              }}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
