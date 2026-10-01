"use client";

import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { SegmentedLinks, withQuery } from "@/components/activity/url-tabs";
import { ChangedList, CallTimeline } from "@/components/agents/run-timeline";
import { formatDuration, formatTokens, RunList } from "@/components/agents/run-list";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { plural } from "@/lib/text";
import { useTRPC } from "@/trpc/client";

/** The tab of the agents page: runs live now, in the last day, or with errors this week. */
export type RunState = "live" | "recent" | "failed";

/** The segmented control's tabs; Today is the default and keeps the URL clean. */
const TABS = [
  { state: "live", label: "Live" },
  { state: "recent", label: "Today" },
  { state: "failed", label: "Failed" },
] as const;

/** How often the Live tab refetches, in milliseconds; replaced by pushed events later. */
const LIVE_REFRESH_MS = 15_000;

/** What each tab says when it has no runs. */
const EMPTY: Record<RunState, { title: string; description: string }> = {
  live: { title: "No live runs", description: "A run is live while its last call is less than 2 minutes old." },
  recent: { title: "No agent runs yet", description: "Runs appear here when someone's agent calls the roadmap with an API key." },
  failed: { title: "No failed runs", description: "Runs with errors in the last 7 days appear here." },
};

/** A run's detail: its call timeline and what changed meanwhile. */
function RunDetail({ slug, runId }: { slug: string; runId: string }) {
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.agents.run.queryOptions({ project: slug, runId }));
  const { data: systems } = useQuery(trpc.systems.list.queryOptions({ project: slug }));
  const { data: releases } = useQuery(trpc.releases.list.queryOptions({ project: slug }));
  if (isPending) return <p className="px-4 text-sm text-muted-foreground">Loading run…</p>;
  if (error) return <p className="px-4 text-sm text-cat-blocked">{error.message}</p>;
  const { run, calls, changes } = data;
  const byId = new Map((systems ?? []).map((s) => [s.id, { slug: s.slug, title: s.title }]));
  const releaseNames = new Map((releases ?? []).map((r) => [r.id, r.name]));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
      <p className="text-[15px] font-semibold">{run.title ?? "Untitled run"}</p>
      <p className="-mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-2">
        <span>{run.userName}</span>
        <span>{formatDuration(run.startedAt, run.lastCallAt)}</span>
        <span>{plural(run.callCount, "call")}</span>
        {run.tokens && <span>{formatTokens(run.tokens.input + run.tokens.output + run.tokens.cacheWrite)} tokens (run total)</span>}
      </p>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">Calls</h3>
        <CallTimeline calls={calls} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">What changed</h3>
        {changes.length === 0 ? <p className="text-sm text-muted-foreground">No changes were made.</p> : <ChangedList changes={changes} projectSlug={slug} systems={byId} releases={releaseNames} />}
      </section>
    </div>
  );
}

/**
 * The agents page body: the Live / Today / Failed control with counts, the run
 * list or an empty state, and the run sheet. The Live tab refreshes every 15 seconds.
 *
 * @param props.slug the project slug
 * @param props.state the tab bound to the `state` search param
 * @param props.runId the run open in the sheet, from `?run=`
 */
export function AgentsView({ slug, state, runId }: { slug: string; state: RunState; runId: string | undefined }) {
  const trpc = useTRPC();
  const router = useRouter();
  const refetchInterval = state === "live" ? LIVE_REFRESH_MS : (false as const);
  const { data: detail } = useSuspenseQuery(trpc.projects.get.queryOptions({ project: slug }));
  const lists = useSuspenseQueries({
    queries: TABS.map((t) => ({ ...trpc.agents.runs.queryOptions({ project: slug, state: t.state }), refetchInterval })),
  });
  const runs = lists[TABS.findIndex((t) => t.state === state)].data;
  const path = `/p/${slug}/agents`;
  const tabHref = (s: RunState) => withQuery(path, {}, { state: s === "recent" ? null : s });
  const runHref = (id: string) => withQuery(path, { state: state === "recent" ? undefined : state }, { run: id });

  return (
    <Page width="narrow">
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title="Agents" />
      <SegmentedLinks
        label="Runs"
        items={TABS.map((t, i) => ({ label: t.label, count: lists[i].data.length, href: tabHref(t.state), active: t.state === state }))}
      />
      {runs.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title={EMPTY[state].title}
          description={EMPTY[state].description}
        />
      ) : (
        <RunList runs={runs} hrefFor={runHref} />
      )}
      <Sheet open={runId !== undefined} onOpenChange={(open) => !open && router.replace(withQuery(path, { state: state === "recent" ? undefined : state }, {}), { scroll: false })}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Agent run</SheetTitle>
            <SheetDescription className="sr-only">The calls of this run and the changes made while it ran.</SheetDescription>
          </SheetHeader>
          {runId && <RunDetail slug={slug} runId={runId} />}
        </SheetContent>
      </Sheet>
    </Page>
  );
}
