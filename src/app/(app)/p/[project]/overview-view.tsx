"use client";

import { useSuspenseQueries } from "@tanstack/react-query";
import { CircleCheck, GitBranch, Milestone, Newspaper, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { AgentTag, CATEGORY_CLASS } from "@/components/chips";
import { NewSystemDialog } from "@/components/new-system-dialog";
import { AttentionList } from "@/components/overview/attention-list";
import { CustomizeDialog } from "@/components/overview/customize-dialog";
import { EmptyState, Page, PageHeader, Panel, ProgressBar } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import type { ColumnCategory } from "@/db/schema";
import { resolvePanels, type PanelId } from "@/lib/overview-panels";
import { useRelativeTime } from "@/lib/use-relative-time";
import { useTRPC } from "@/trpc/client";

/** Order of the status bar's segments and legend. */
const SEGMENTS: ColumnCategory[] = ["done", "review", "active", "todo", "blocked", "planning"];

/** Returns a repository URL without its scheme and host, for display ("org/repo"). */
function repoLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "") || parsed.host;
  } catch {
    return url;
  }
}

/**
 * The overview body: status of all systems by category, what needs attention,
 * progress per phase and the latest progress updates.
 *
 * @param props.slug the project slug
 */
export function OverviewView({ slug }: { slug: string }) {
  const t = useTranslations("overview");
  const tCategory = useTranslations("enums.category");
  const relative = useRelativeTime();
  const trpc = useTRPC();
  const [customizing, setCustomizing] = useState(false);
  const [
    { data: detail },
    { data: systems },
    { data: phases },
    { data: updates },
    { data: activity },
    { data: attention },
    { data: panelPref },
  ] = useSuspenseQueries({
    queries: [
      trpc.projects.get.queryOptions({ project: slug }),
      trpc.systems.list.queryOptions({ project: slug }),
      trpc.structure.phases.queryOptions({ project: slug }),
      trpc.history.updates.queryOptions({ project: slug, filter: { limit: 8 } }),
      trpc.history.activity.queryOptions({ project: slug, filter: { limit: 1 } }),
      trpc.projects.attention.queryOptions({ project: slug }),
      trpc.prefs.get.queryOptions({ key: "overview.panels" }),
    ],
  });
  const data = { detail, systems, phases, updates, activity };
  const { project } = data.detail;
  const canEdit = data.detail.role !== "viewer" && !project.archivedAt;
  const tasksDone = data.systems.reduce((n, s) => n + s.tasksDone, 0);
  const tasksTotal = data.systems.reduce((n, s) => n + s.tasksTotal, 0);
  const counts = SEGMENTS.map((c) => ({ category: c, n: data.systems.filter((s) => s.columnCategory === c).length }));
  const lastChange = [data.activity[0]?.createdAt, data.updates[0]?.createdAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const base = `/p/${slug}`;

  const newSystem = canEdit && data.detail.boards.length > 0 && (
    <NewSystemDialog projectSlug={slug} boards={data.detail.boards.map((b) => ({ slug: b.slug, name: b.name }))} />
  );

  const panels = resolvePanels(panelPref);
  const panelNodes: Record<PanelId, React.ReactNode> = {
    status: (
      <section aria-label={t("systemsByStatus")} className="flex flex-col gap-3 border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="text-[15px] font-semibold">{t("systemCount", { count: data.systems.length })}</h2>
          <span className="text-[13px] text-muted-foreground">
            {lastChange
              ? t("tasksDoneLastChange", { done: tasksDone, total: tasksTotal, age: relative(lastChange) })
              : t("tasksDone", { done: tasksDone, total: tasksTotal })}
          </span>
        </div>
        <div className="flex h-2.5 gap-[3px]" aria-hidden>
          {data.systems.length === 0 ? (
            <span className="flex-1 bg-track" />
          ) : (
            counts.filter((c) => c.n > 0).map((c) => <span key={c.category} className={CATEGORY_CLASS[c.category]} style={{ flexGrow: c.n }} />)
          )}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
          {counts.map((c) => (
            <li key={c.category} className="flex items-center gap-[7px] text-[13px] text-fg-2">
              <span aria-hidden className={`size-2 rounded-full ${CATEGORY_CLASS[c.category]}`} />
              {tCategory(c.category)} <b className="font-semibold text-foreground">{c.n}</b>
            </li>
          ))}
        </ul>
      </section>
    ),
    attention: (
      <Panel title={t("panels.attention")} meta={attention.length > 0 && t("attention.itemCount", { count: attention.length })}>
        {attention.length > 0 ? (
          <AttentionList items={attention} />
        ) : (
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <EmptyState
              icon={<CircleCheck />}
              title={t("attention.emptyTitle")}
              description={t("attention.emptyDescription")}
            />
          </div>
        )}
      </Panel>
    ),
    phases: (
      <Panel
        title={t("panels.phases")}
        action={
          <Link href={`${base}/roadmap`} className="text-[13px] font-medium text-brand-strong hover:underline">
            {t("phases.openRoadmap")}
          </Link>
        }
        bodyClassName="px-4 pb-3 sm:px-5"
      >
        {data.phases.length === 0 ? (
          <EmptyState
            icon={<Milestone />}
            title={t("phases.emptyTitle")}
            description={t("phases.emptyDescription")}
            className="mb-2"
            action={
              canEdit && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`${base}/settings/structure`}>{t("phases.add")}</Link>
                </Button>
              )
            }
          />
        ) : (
          <ol className="flex flex-col">
            {data.phases.map((p, i) => {
              const items = data.systems.filter((s) => s.phaseId === p.id);
              const done = items.filter((s) => s.columnCategory === "done").length;
              const complete = items.length > 0 && done === items.length;
              return (
                <li key={p.id} className="grid grid-cols-[22px_minmax(0,150px)_minmax(0,1fr)_48px] items-center gap-3 py-[7px]">
                  <span className="font-mono text-[11.5px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <span className="truncate font-medium">{p.name}</span>
                  <ProgressBar value={done} total={items.length} colorClass={complete ? "bg-cat-done" : "bg-primary"} className="h-1.5 min-w-0" />
                  <span className="text-right font-mono text-[12.5px] text-fg-2">
                    {done}/{items.length}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    ),
    updates: (
      <Panel
        title={t("panels.updates")}
        action={
          <Link href={`${base}/activity`} className="text-[13px] font-medium text-brand-strong hover:underline">
            {t("updates.allActivity")}
          </Link>
        }
      >
        {data.updates.length === 0 ? (
          <div className="px-4 pb-4 sm:px-5 sm:pb-5">
            <EmptyState icon={<Newspaper />} title={t("updates.emptyTitle")} description={t("updates.emptyDescription")} />
          </div>
        ) : (
          <ol className="flex flex-col">
            {data.updates.map((u) => {
              const { authorName: name, agent } = u;
              return (
                <li key={u.id}>
                  <article className="flex gap-3 border-t px-4 py-3 sm:px-5">
                    <PersonAvatar name={name} size="md" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{name}</span>
                        {agent && <AgentTag agent={agent} />}
                        <span>{t("updates.on")}</span>
                        <Link href={`${base}/systems/${u.systemSlug}`} className="font-medium text-fg-2 hover:text-foreground hover:underline">
                          {u.systemTitle}
                        </Link>
                        <time className="ml-auto whitespace-nowrap" dateTime={u.createdAt.toISOString()}>
                          {relative(u.createdAt)}
                        </time>
                      </div>
                      <p className="line-clamp-3 text-[13.5px] leading-normal break-words">{u.summary}</p>
                      {u.commitHash &&
                        (u.commitUrl ? (
                          <a
                            href={u.commitUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="self-start font-mono text-[11.5px] text-brand-strong hover:underline"
                          >
                            {u.commitHash.slice(0, 7)}
                          </a>
                        ) : (
                          <span className="self-start font-mono text-[11.5px] text-muted-foreground">{u.commitHash.slice(0, 7)}</span>
                        ))}
                    </div>
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    ),
  };
  const shown = panels.filter((p) => p.visible);
  const wide = shown.find((p) => p.id === "status");
  const rest = shown.filter((p) => p.id !== "status");
  const leftCount = Math.ceil(rest.length / 2);
  const left = rest.slice(0, leftCount);
  const right = rest.slice(leftCount);

  return (
    <Page>
      <PageHeader
        title={project.name}
        description={project.description || undefined}
        actions={
          <>
            {project.repoUrl && (
              <Button variant="outline" asChild className="text-[13px] font-normal text-fg-2">
                <a href={project.repoUrl} target="_blank" rel="noreferrer noopener">
                  <GitBranch aria-hidden className="size-3.5" />
                  {repoLabel(project.repoUrl)}
                </a>
              </Button>
            )}
            <Button variant="outline" onClick={() => setCustomizing(true)} className="text-[13px] font-normal text-fg-2">
              <SlidersHorizontal aria-hidden className="size-3.5" />
              {t("customize")}
            </Button>
            {newSystem}
          </>
        }
      />

      {wide && <Fragment key="status">{panelNodes.status}</Fragment>}

      {rest.length > 0 && (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-5">
            {left.map((p) => (
              <Fragment key={p.id}>{panelNodes[p.id]}</Fragment>
            ))}
          </div>
          {right.length > 0 && (
            <div className="flex flex-col gap-5">
              {right.map((p) => (
                <Fragment key={p.id}>{panelNodes[p.id]}</Fragment>
              ))}
            </div>
          )}
        </div>
      )}
      <CustomizeDialog panels={panels} open={customizing} onOpenChange={setCustomizing} />
    </Page>
  );
}
