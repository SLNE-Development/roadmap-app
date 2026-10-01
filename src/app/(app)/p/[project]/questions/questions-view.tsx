"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { CircleHelp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { UnderlineTabs, withQuery } from "@/components/activity/url-tabs";
import { FilterChip } from "@/components/filter-chip";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { QuestionCard } from "@/components/question-card";
import { AskQuestionDialog } from "@/components/questions/ask-question-dialog";
import { useTRPC } from "@/trpc/client";

/**
 * The questions page body: the tabs with counts, the system filter, the
 * "Ask a question" dialog for editors and the question cards.
 *
 * @param props.slug the project slug
 * @param props.tab the tab from `?tab=`
 * @param props.systemSlug the system from `?system=`; unknown slugs show every system
 */
export function QuestionsView({ slug, tab, systemSlug }: { slug: string; tab: "open" | "resolved"; systemSlug: string | undefined }) {
  const trpc = useTRPC();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [{ data: questions }, { data: systems }, { data: detail }] = useSuspenseQueries({
    queries: [
      trpc.questions.list.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
      trpc.projects.get.queryOptions({ project: slug }),
    ],
  });
  const canEdit = detail.role !== "viewer" && !detail.project.archivedAt;
  const system = systems.find((s) => s.slug === systemSlug);
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
          value={system?.slug ?? ""}
          onChange={(v) =>
            startTransition(() => router.replace(withQuery(path, query, { system: v || null }), { scroll: false }))
          }
          options={withSystems.map((s) => ({ value: s.slug, label: s.title }))}
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
                priority: q.priority,
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
