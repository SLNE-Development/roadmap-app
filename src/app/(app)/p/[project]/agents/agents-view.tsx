"use client";

import { useQuery, useSuspenseQueries, useSuspenseQuery } from "@tanstack/react-query";
import { Bot } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { SegmentedLinks, withQuery } from "@/components/activity/url-tabs";
import { ChangedList, CallTimeline } from "@/components/agents/run-timeline";
import { formatDuration, formatTokens, RunList } from "@/components/agents/run-list";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTRPC } from "@/trpc/client";

/** The tab of the agents page: runs live now, in the last day, or with errors this week. */
export type RunState = "live" | "recent" | "failed";

/** The segmented control's tabs; Today is the default and keeps the URL clean. */
const TABS = [{ state: "live" }, { state: "recent" }, { state: "failed" }] as const;

/** How often the Live tab refetches, in milliseconds; replaced by pushed events later. */
const LIVE_REFRESH_MS = 15_000;

/** A run's detail: its call timeline and what changed meanwhile. */
function RunDetail({ slug, runId }: { slug: string; runId: string }) {
  const t = useTranslations("activity.agents");
  const locale = useLocale();
  const trpc = useTRPC();
  const { data, isPending, error } = useQuery(trpc.agents.run.queryOptions({ project: slug, runId }));
  const { data: systems } = useQuery(trpc.systems.list.queryOptions({ project: slug }));
  const { data: releases } = useQuery(trpc.releases.list.queryOptions({ project: slug }));
  if (isPending) return <p className="px-4 text-sm text-muted-foreground">{t("loadingRun")}</p>;
  if (error) return <p className="px-4 text-sm text-cat-blocked">{error.message}</p>;
  const { run, calls, changes } = data;
  const byId = new Map((systems ?? []).map((s) => [s.id, { slug: s.slug, title: s.title }]));
  const releaseNames = new Map((releases ?? []).map((r) => [r.id, r.name]));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6">
      <p className="text-[15px] font-semibold">{run.title ?? t("untitledRun")}</p>
      <p className="-mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-2">
        <span>{run.userName}</span>
        <span>{formatDuration(run.startedAt, run.lastCallAt)}</span>
        <span>{t("calls", { count: run.callCount })}</span>
        {run.tokens && <span>{t("tokens", { tokens: formatTokens(run.tokens.input + run.tokens.output + run.tokens.cacheWrite, locale) })}</span>}
      </p>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{t("callsHeading")}</h3>
        <CallTimeline calls={calls} />
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{t("changedHeading")}</h3>
        {changes.length === 0 ? <p className="text-sm text-muted-foreground">{t("noChanges")}</p> : <ChangedList changes={changes} projectSlug={slug} systems={byId} releases={releaseNames} />}
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
  const t = useTranslations("activity.agents");
  const trpc = useTRPC();
  const router = useRouter();
  const refetchInterval = state === "live" ? LIVE_REFRESH_MS : (false as const);
  const { data: detail } = useSuspenseQuery(trpc.projects.get.queryOptions({ project: slug }));
  const lists = useSuspenseQueries({
    queries: TABS.map((tab) => ({ ...trpc.agents.runs.queryOptions({ project: slug, state: tab.state }), refetchInterval })),
  });
  const runs = lists[TABS.findIndex((tab) => tab.state === state)].data;
  const path = `/p/${slug}/agents`;
  const tabHref = (s: RunState) => withQuery(path, {}, { state: s === "recent" ? null : s });
  const runHref = (id: string) => withQuery(path, { state: state === "recent" ? undefined : state }, { run: id });

  return (
    <Page width="narrow">
      <PageHeader crumbs={[{ label: detail.project.name, href: `/p/${slug}` }]} title={t("title")} />
      <SegmentedLinks
        label={t("runsLabel")}
        items={TABS.map((tab, i) => ({ label: t(`tabs.${tab.state}`), count: lists[i].data.length, href: tabHref(tab.state), active: tab.state === state }))}
      />
      {runs.length === 0 ? (
        <EmptyState
          icon={<Bot />}
          title={t(`empty.${state}.title`)}
          description={t(`empty.${state}.description`)}
        />
      ) : (
        <RunList runs={runs} hrefFor={runHref} />
      )}
      <Sheet open={runId !== undefined} onOpenChange={(open) => !open && router.replace(withQuery(path, { state: state === "recent" ? undefined : state }, {}), { scroll: false })}>
        <SheetContent className="sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{t("sheetTitle")}</SheetTitle>
            <SheetDescription className="sr-only">{t("sheetDescription")}</SheetDescription>
          </SheetHeader>
          {runId && <RunDetail slug={slug} runId={runId} />}
        </SheetContent>
      </Sheet>
    </Page>
  );
}
