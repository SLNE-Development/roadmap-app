import { GitCommitHorizontal, History } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { documentCompare } from "@/components/activity/change-sentence";
import { foldActivity } from "@/components/activity/fold";
import { FoldedRow } from "@/components/activity/folded-row";
import type { TimelineItem } from "@/components/activity/timeline";
import { useNow } from "@/components/clock";
import { Markdown } from "@/components/markdown";
import { EmptyState } from "@/components/page";
import { priorityKey } from "@/i18n/enums";
import { PRIORITIES, TASK_STATES, type PlanningArea } from "@/db/schema";
import type { Messages } from "@/i18n/request";
import type { HistoryEntry } from "@/lib/ops/activity";
import type { UpdateItem } from "@/lib/ops/updates";
import { AuthorBadge } from "./author";
import { compareHref } from "./tabs";
import { areaKey } from "./text";

/** Names that change sentences need: task titles by id, and domain and phase names by id. */
export interface ActivityNames {
  tasks: Map<string, string>;
  domains: Map<string, string>;
  phases: Map<string, string>;
}

/** One entry of the merged feed. */
type FeedItem = { kind: "update"; at: Date; update: UpdateItem } | { kind: "change"; at: Date; change: HistoryEntry };

/** The item as folding sees it: who, when and which kind. The sentence is rendered from the original, not from this. */
function foldable(item: FeedItem): TimelineItem {
  if (item.kind === "update") {
    const u = item.update;
    return { kind: "update", key: `u-${u.id}`, createdAt: u.createdAt.toISOString(), authorName: u.authorName, agent: u.agent, systemSlug: "", systemTitle: "", taskTitle: null, summary: "", nextStep: null, commitHash: null, commitUrl: null };
  }
  const c = item.change;
  return { kind: "change", key: `c-${c.id}`, createdAt: c.createdAt.toISOString(), authorName: c.authorName, agent: c.agent, sentence: { verb: "", target: null, targetIsSystem: false }, systemSlug: null, toCategory: null };
}

/**
 * Returns the feed's time formatters, all in the user's time zone and measured against the render clock:
 * the {@link time} of day, a {@link relative} age such as "5 minutes ago", and the {@link day} a timestamp
 * falls on, as a grouping key and a label ("Today", "Yesterday" or the date).
 */
export function useTimeText() {
  const format = useFormatter();
  const t = useTranslations("activity");
  const now = useNow();
  const dayKey = (d: Date) => format.dateTime(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  return {
    time: (d: Date) => format.dateTime(d, { hour: "2-digit", minute: "2-digit" }),
    relative: (d: Date) => format.relativeTime(d, now),
    day: (d: Date) => {
      const key = dayKey(d);
      if (key === dayKey(now)) return { key, label: t("today") };
      if (key === dayKey(new Date(now.getTime() - 86_400_000))) return { key, label: t("yesterday") };
      const sameYear = format.dateTime(d, { year: "numeric" }) === format.dateTime(now, { year: "numeric" });
      return { key, label: format.dateTime(d, sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" }) };
    },
  };
}

/** Drops a "Board / " prefix both values share, so a move within a board names only the columns. */
function columnNames(from: string | null, to: string | null, nowhere: string): [string, string] {
  const split = (v: string | null) => (v ?? "").split(" / ");
  const [fb, fc] = split(from);
  const [tb, tc] = split(to);
  if (fc !== undefined && tc !== undefined && fb === tb) return [fc, tc];
  return [from ?? nowhere, to ?? nowhere];
}

/** The translator of the `system` namespace that {@link describeChange} writes sentences with. */
export type SystemT = ReturnType<typeof useTranslations<"system">>;

/** The message keys of the change sentences. */
type ChangeKey = keyof Messages["system"]["activity"]["change"];

/** The translator of the `enums` namespace, for task states and priorities. */
export type EnumsT = ReturnType<typeof useTranslations<"enums">>;

/** Returns the area's display name for a stored area slug, or the slug itself when it is not one. */
function areaName(slug: string | null, t: SystemT): string {
  return slug && ["failure-modes", "dependencies", "scope", "ops-testing"].includes(slug) ? t(`gaps.areaNames.${areaKey(slug as PlanningArea)}`) : (slug ?? t("activity.change.planningArea"));
}

/** Describes a change log entry as the end of a sentence that starts with its author. */
export function describeChange(e: HistoryEntry, names: ActivityNames, t: SystemT, te: EnumsT): string {
  const task = names.tasks.get(e.entityId);
  const c = (key: ChangeKey, values?: Record<string, string | number>) => t(`activity.change.${key}`, values);
  /** A title in quotation marks; a missing one reads as "a task". */
  const q = (text: string | null | undefined) => c("quoted", { title: text ?? c("aTask") });
  const priority = (v: string | null) => ((PRIORITIES as readonly string[]).includes(v ?? "") ? te(`priority.${priorityKey(v as (typeof PRIORITIES)[number])}`) : (v ?? ""));
  switch (`${e.entity}.${e.field}`) {
    case "system.created":
      return c("systemCreated");
    case "system.column": {
      const [from, to] = columnNames(e.oldValue, e.newValue, c("nowhere"));
      return c("systemColumn", { from, to });
    }
    case "system.priority":
      return c("systemPriority", { from: priority(e.oldValue), to: priority(e.newValue) });
    case "system.owner":
      return e.newValue ? c("systemOwnerSet", { name: e.newValue }) : c("systemOwnerRemoved", { name: e.oldValue ?? c("theOwner") });
    case "system.title":
      return c("systemTitle", { from: q(e.oldValue), to: q(e.newValue) });
    case "system.summary":
      return c("systemSummary");
    case "system.notes":
      return c("systemNotes");
    case "system.domainId":
      return e.newValue ? c("domainSet", { name: names.domains.get(e.newValue) ?? c("removedDomain") }) : c("domainCleared");
    case "system.phaseId":
      return e.newValue ? c("phaseSet", { name: names.phases.get(e.newValue) ?? c("removedPhase") }) : c("phaseCleared");
    case "system.release":
      return e.newValue ? c("releaseSet", { name: e.newValue }) : c("releaseRemoved", { name: e.oldValue ?? c("itsRelease") });
    case "system.gateOverride": {
      // newValue is "<column>: <reason>".
      const text = e.newValue ?? "";
      const i = text.indexOf(": ");
      return i === -1 ? c("gateOverrideBare") : c("gateOverride", { column: text.slice(0, i), reason: text.slice(i + 2) });
    }
    case "column.rules":
      return e.newValue ? c("columnRulesSet", { rules: e.newValue }) : c("columnRulesRemoved");
    case "task.created":
      return c("taskCreated", { title: q(e.newValue) });
    case "task.deleted":
      return c("taskDeleted", { title: q(e.oldValue) });
    case "task.title":
      return c("taskTitle", { from: q(e.oldValue), to: q(e.newValue) });
    case "task.state":
      return c("taskState", { title: q(task), state: (TASK_STATES as readonly string[]).includes(e.newValue ?? "") ? te(`taskState.${e.newValue as (typeof TASK_STATES)[number]}`) : (e.newValue ?? "") });
    case "task.priority":
      return c("taskPriority", { title: q(task), priority: priority(e.newValue) });
    case "task.owner":
      return e.newValue ? c("taskOwnerSet", { title: q(task), name: e.newValue }) : c("taskUnassigned", { title: q(task) });
    case "planning.round": {
      const m = /^round (\d+): (\d+) questions$/.exec(e.newValue ?? "");
      return m ? c("planningRound", { round: m[1], count: Number(m[2]) }) : c("planningRoundBare");
    }
    case "planning.answers": {
      const n = Number.parseInt(e.newValue ?? "", 10);
      return Number.isFinite(n) ? c("planningAnswers", { count: n }) : c("planningAnswersBare");
    }
    case "planning.completed":
      return c("planningCompleted");
    case "planning.reopened":
      return c("planningReopened");
    case "planning.area-reopened":
      return c("areaReopened", { area: areaName(e.newValue, t) });
    case "planning.area-completed":
      return c("areaCompleted", { area: areaName(e.newValue, t) });
    case "document.spec":
      return c("specWritten", { version: e.newValue ?? "" }).trim();
    case "document.plan":
      return c("planWritten", { version: e.newValue ?? "" }).trim();
    case "question.created":
      return c("questionAsked", { title: q(e.newValue) });
    case "question.answer":
      return c("questionAnswered");
    case "question.resolved":
      return e.newValue === "true" ? c("questionResolved") : c("questionReopened");
    default:
      return c("fallback", { entity: e.entity, field: e.field });
  }
}

/** A progress update in the feed: author, summary, next step, task and commit. */
function UpdateEntry({ update: u }: { update: UpdateItem }) {
  const t = useTranslations("system.activity");
  const { time, relative } = useTimeText();
  return (
    <div className="flex flex-col gap-2 border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <AuthorBadge name={u.authorName} agent={u.agent} />
        <span className="text-muted-foreground">{t("postedUpdate")}</span>
        <time className="ml-auto text-xs text-muted-foreground tabular-nums" dateTime={u.createdAt.toISOString()} title={relative(u.createdAt)}>
          {time(u.createdAt)}
        </time>
      </div>
      <Markdown className="text-sm">{u.summary}</Markdown>
      {u.nextStep && (
        <p className="text-[13px] text-fg-2">
          <span className="font-medium text-foreground">{t("next")}</span> {u.nextStep}
        </p>
      )}
      {(u.taskTitle || u.commitHash) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
          {u.taskTitle && <span>{t("task", { title: u.taskTitle })}</span>}
          {u.commitHash &&
            (u.commitUrl ? (
              <a
                href={u.commitUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-mono text-brand-strong hover:underline"
                aria-label={t("commit", { hash: u.commitHash.slice(0, 7) })}
              >
                <GitCommitHorizontal aria-hidden className="size-3.5" />
                {u.commitHash.slice(0, 7)}
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 font-mono">
                <GitCommitHorizontal aria-hidden className="size-3.5" />
                {u.commitHash.slice(0, 7)}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}

/** A change in the feed, as one readable sentence. */
function ChangeEntry({ change: e, names, base }: { change: HistoryEntry; names: ActivityNames; base: string }) {
  const t = useTranslations("system");
  const te = useTranslations("enums");
  const { time, relative } = useTimeText();
  const compare = documentCompare(e);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-[13px]">
      <AuthorBadge name={e.authorName} agent={e.agent} />
      <span className="min-w-0 flex-1 text-fg-2">
        {describeChange(e, names, t, te)}
        {compare && (
          <>
            {" "}
            <Link href={compareHref(base, compare.tab, compare.from, compare.to)} className="text-brand-strong hover:underline">
              {t("activity.compare", { from: compare.from })}
            </Link>
          </>
        )}
      </span>
      <time className="text-xs text-muted-foreground tabular-nums" dateTime={e.createdAt.toISOString()} title={relative(e.createdAt)}>
        {time(e.createdAt)}
      </time>
    </div>
  );
}

/**
 * The system's activity, newest first and grouped by day: progress updates as
 * cards and changes as sentences. Update postings in the change log are left
 * out because the updates themselves are shown.
 *
 * @param props.base the system page URL, for the "Compare" links of spec and plan entries
 */
export function ActivityFeed({ updates, changes, names, base }: { updates: UpdateItem[]; changes: HistoryEntry[]; names: ActivityNames; base: string }) {
  const t = useTranslations("system.activity");
  const { day } = useTimeText();
  const items: FeedItem[] = [
    ...updates.map((u) => ({ kind: "update" as const, at: u.createdAt, update: u })),
    ...changes.map((c) => ({ kind: "change" as const, at: c.createdAt, change: c })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  if (items.length === 0) {
    return <EmptyState icon={<History />} title={t("emptyTitle")} description={t("emptyDescription")} />;
  }
  const byKey = new Map(items.map((i) => [i.kind === "update" ? `u-${i.update.id}` : `c-${i.change.id}`, i]));
  const days: { key: string; label: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const { key, label } = day(item.at);
    if (days.at(-1)?.key !== key) days.push({ key, label, items: [] });
    days[days.length - 1].items.push(item);
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map((d) => (
        <section key={d.key} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{d.label}</h2>
          <ol className="flex flex-col gap-2">
            {foldActivity(d.items.map(foldable)).map((entry) => {
              if (entry.kind === "fold") {
                return (
                  <li key={entry.key}>
                    <ol className="flex flex-col border bg-card">
                      <FoldedRow group={entry}>
                        {entry.items.map((c) => (
                          <li key={c.key} className="border-b last:border-b-0">
                            <ChangeEntry change={(byKey.get(c.key) as Extract<FeedItem, { kind: "change" }>).change} names={names} base={base} />
                          </li>
                        ))}
                      </FoldedRow>
                    </ol>
                  </li>
                );
              }
              const item = byKey.get(entry.key)!;
              return <li key={entry.key}>{item.kind === "update" ? <UpdateEntry update={item.update} /> : <ChangeEntry change={item.change} names={names} base={base} />}</li>;
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
