"use client";

import { useMutation, useQuery, useSuspenseQueries } from "@tanstack/react-query";
import { Lock, LockOpen } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { UnderlineTabs } from "@/components/activity/url-tabs";
import { CATEGORY_CLASS, StatusChip } from "@/components/chips";
import { useNow } from "@/components/clock";
import { BurnupChart } from "@/components/insight/burnup-chart";
import { useFinishText } from "@/components/insight/stat-tiles";
import { Page, PageHeader, Panel } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { DeleteReleaseDialog } from "@/components/releases/delete-release-dialog";
import { EditReleaseDialog } from "@/components/releases/edit-release-dialog";
import { ReleaseRiskChip, ReleaseStatusChip } from "@/components/releases/release-chips";
import { ReleaseNotes } from "@/components/releases/release-notes";
import { ShipReleaseDialog } from "@/components/releases/ship-release-dialog";
import { Button } from "@/components/ui/button";
import { COLUMN_CATEGORIES } from "@/db/schema";
import type { ReleaseSystem } from "@/lib/ops/releases";
import { daysUntil } from "@/lib/time";
import { useShortDate } from "@/lib/use-short-date";
import { useTRPC } from "@/trpc/client";

/** One big number with a caption and an optional chip. */
function Tile({ value, caption, children }: { value: string; caption: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border bg-card px-4 py-3.5">
      <span className="text-[22px] leading-tight font-semibold tabular-nums">{value}</span>
      <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
        {caption}
        {children}
      </span>
    </div>
  );
}

type ReleasesT = ReturnType<typeof useTranslations<"insight.releases">>;

/** What is left for a system: its open tasks, or the Done rules it still misses. */
function detailLine(t: ReleasesT, s: ReleaseSystem): string {
  if (s.tasksDone < s.tasksTotal) return t("detail.tasksProgress", { done: s.tasksDone, total: s.tasksTotal });
  if (s.gatesTotal > 0 && s.gatesUnmet > 0) return t("detail.rulesMet", { met: s.gatesTotal - s.gatesUnmet, total: s.gatesTotal });
  return s.tasksTotal > 0 ? t("detail.tasksDone", { total: s.tasksTotal }) : t("detail.noTasks");
}

/** The countdown to a target date: days left, due today or days overdue. */
function countdown(t: ReleasesT, target: string, now: Date): string {
  const days = daysUntil(target, now);
  if (days > 0) return t("daysLeft", { count: days });
  return days === 0 ? t("dueToday") : t("daysOverdue", { count: -days });
}

/**
 * A release page: target and freeze state, tiles, category bar, the systems not done yet and the burn-up
 * on the overview tab, the versioned release notes on the other. Editors edit a planned release; owners also
 * edit a frozen one, freeze, unfreeze and ship, and delete a planned one.
 *
 * @param props.tab the open tab
 * @param props.version the notes version to show, the latest when undefined
 * @param props.burnupDays the window of the burn-up in days
 */
export function ReleaseView({
  slug,
  releaseSlug,
  tab,
  version,
  burnupDays,
}: {
  slug: string;
  releaseSlug: string;
  tab: "overview" | "notes";
  version: number | undefined;
  burnupDays: 90;
}) {
  const t = useTranslations("insight.releases");
  const tc = useTranslations("common");
  const tCategory = useTranslations("enums.category");
  const format = useFormatter();
  const shortDate = useShortDate();
  const finishText = useFinishText();
  const trpc = useTRPC();
  const now = useNow();
  const ref = { project: slug, release: releaseSlug };
  const [{ data: detail }, { data: project }] = useSuspenseQueries({
    queries: [trpc.releases.get.queryOptions(ref), trpc.projects.get.queryOptions({ project: slug })],
  });
  const { release: r, systems, counts, openQuestions, risk, projection, frozenBy, latestNote } = detail;
  const progress = useQuery({
    ...trpc.insight.progress.queryOptions({ project: slug, filter: { release: releaseSlug, days: burnupDays } }),
    enabled: tab === "overview",
  });
  const freeze = useMutation(trpc.releases.freeze.mutationOptions());
  const unfreeze = useMutation(trpc.releases.unfreeze.mutationOptions());

  const active = !project.project.archivedAt;
  const canEdit = project.role !== "viewer" && active;
  const isOwner = (project.role === "owner" || project.role === "admin") && active;
  const canEditRelease = r.status === "planned" ? canEdit : r.status === "frozen" && isOwner;
  const base = `/p/${slug}/releases/${releaseSlug}`;
  const notDone = systems.filter((s) => s.category !== "done");
  const shownCategories = COLUMN_CATEGORIES.filter((c) => counts[c] > 0);
  const headline = r.targetDate ? t("headerTarget", { name: r.name, date: shortDate(r.targetDate, { dayKey: true }) }) : t("headerNoTarget", { name: r.name });
  const state = [
    r.status === "frozen" && r.frozenAt
      ? frozenBy
        ? t("frozenOnBy", { date: shortDate(new Date(r.frozenAt)), name: frozenBy })
        : t("frozenOn", { date: shortDate(new Date(r.frozenAt)) })
      : null,
    r.status === "shipped" && r.shippedAt ? t("shippedOn", { date: shortDate(new Date(r.shippedAt)) }) : null,
    r.status !== "shipped" && r.targetDate ? countdown(t, r.targetDate, now) : null,
  ].filter(Boolean);

  const actions = (
    <>
      <ReleaseStatusChip status={r.status} />
      {canEditRelease && <EditReleaseDialog projectSlug={slug} release={{ slug: r.slug, name: r.name, targetDate: r.targetDate }} />}
      {isOwner && r.status === "planned" && <DeleteReleaseDialog projectSlug={slug} releaseSlug={releaseSlug} releaseName={r.name} />}
      {isOwner && r.status === "planned" && (
        <Button variant="outline" disabled={freeze.isPending} onClick={() => freeze.mutate(ref, { onSuccess: () => toast.success(t("froze", { name: r.name })) })}>
          <Lock aria-hidden />
          {t("freeze")}
        </Button>
      )}
      {isOwner && r.status === "frozen" && (
        <Button variant="outline" disabled={unfreeze.isPending} onClick={() => unfreeze.mutate(ref, { onSuccess: () => toast.success(t("unfroze", { name: r.name })) })}>
          <LockOpen aria-hidden />
          {t("unfreeze")}
        </Button>
      )}
      {isOwner && r.status !== "shipped" && (
        <ShipReleaseDialog projectSlug={slug} releaseSlug={releaseSlug} releaseName={r.name} unfinished={notDone.map((s) => s.title)} />
      )}
    </>
  );

  return (
    <Page>
      <PageHeader
        crumbs={[{ label: project.project.name, href: `/p/${slug}` }, { label: t("title"), href: `/p/${slug}/releases` }, { label: r.name }]}
        title={r.name}
        description={
          <>
            <p>{headline}</p>
            {state.length > 0 && <p>{state.join(" · ")}</p>}
          </>
        }
        actions={actions}
      />
      <UnderlineTabs
        label={t("tabs.label")}
        tabs={[
          { label: t("tabs.overview"), href: base, active: tab === "overview" },
          { label: t("tabs.notes"), href: `${base}?tab=notes`, active: tab === "notes" },
        ]}
      />
      {tab === "notes" ? (
        <ReleaseNotes projectSlug={slug} releaseSlug={releaseSlug} latest={latestNote?.version ?? null} version={version} canEdit={canEdit} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile value={`${counts.done} / ${systems.length}`} caption={t("tiles.systemsDone")} />
            <Tile value={String(openQuestions.length)} caption={t("tiles.openQuestions")} />
            <Tile value={finishText(projection)} caption={t("tiles.projectedFinish")}>
              <ReleaseRiskChip risk={risk} />
            </Tile>
          </div>
          {systems.length > 0 && (
            <div className="flex flex-col gap-2">
              <div role="img" aria-label={format.list(shownCategories.map((c) => `${counts[c]} ${tCategory(c)}`), { type: "unit" })} className="flex h-2 bg-secondary">
                {shownCategories.map((c) => (
                  <span key={c} className={CATEGORY_CLASS[c]} style={{ width: `${(100 * counts[c]) / systems.length}%` }} />
                ))}
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-fg-2">
                {shownCategories.map((c) => (
                  <li key={c} className="flex items-center gap-1.5">
                    <span aria-hidden className={`size-2 ${CATEGORY_CLASS[c]}`} />
                    {tCategory(c)} {counts[c]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Panel title={t("notDone")} meta={systems.length === 0 ? undefined : t("notDoneMeta", { count: notDone.length, total: systems.length })} bodyClassName="pb-2">
            {systems.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground sm:px-5">{t("noSystems")}</p>
            ) : notDone.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-muted-foreground sm:px-5">{t("allDone")}</p>
            ) : (
              <ul>
                {notDone.map((s) => (
                  <li key={s.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2.5 text-[13.5px] sm:px-5">
                    <Link href={`/p/${slug}/systems/${s.slug}`} className="min-w-0 flex-1 truncate font-semibold hover:underline focus-visible:underline focus-visible:outline-none">
                      {s.title}
                    </Link>
                    <StatusChip category={s.category} name={tCategory(s.category)} />
                    <span className="text-[12.5px] text-fg-2">{detailLine(t, s)}</span>
                    <span className="min-w-24 text-[12.5px] text-fg-2">
                      {s.ownerName ? <PersonName name={s.ownerName} size="sm" className="gap-2" /> : <span className="text-muted-foreground">{t("unowned")}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t("burnup")} bodyClassName="px-4 pb-4 sm:px-5">
            {progress.data && progress.data.points.length > 0 ? (
              <BurnupChart points={progress.data.points} projection={progress.data.projection} />
            ) : (
              <p className="text-[13px] text-muted-foreground">{progress.isPending ? tc("loading") : t("noTasks")}</p>
            )}
          </Panel>
        </>
      )}
    </Page>
  );
}
