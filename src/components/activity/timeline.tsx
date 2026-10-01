import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { AgentTag, CATEGORY_TEXT } from "@/components/chips";
import { useNow } from "@/components/clock";
import { Markdown } from "@/components/markdown";
import { PersonAvatar } from "@/components/person-avatar";
import type { ColumnCategory } from "@/db/schema";
import { dayLabel, formatDate, formatTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { describeChange, type ChangeFacts, type ChangeSentence } from "./change-sentence";

/** Who made a timeline entry: the person and, when one acted for them, the agent. */
export interface TimelineAuthor {
  authorName: string;
  agent: string | null;
}

/** A progress update in the timeline. */
export interface UpdateTimelineItem extends TimelineAuthor {
  kind: "update";
  key: string;
  createdAt: string;
  systemSlug: string;
  systemTitle: string;
  taskTitle: string | null;
  summary: string;
  nextStep: string | null;
  commitHash: string | null;
  commitUrl: string | null;
}

/** A change log entry in the timeline, already turned into a sentence. */
export interface ChangeTimelineItem extends TimelineAuthor {
  kind: "change";
  key: string;
  createdAt: string;
  sentence: ChangeSentence;
  systemSlug: string | null;
  toCategory: ColumnCategory | null;
}

/** One entry of the activity timeline. */
export type TimelineItem = UpdateTimelineItem | ChangeTimelineItem;

/** A progress update as the ops layer returns it, with an ISO timestamp. */
export interface UpdateLike extends TimelineAuthor {
  id: string;
  createdAt: string;
  systemSlug: string;
  systemTitle: string;
  taskTitle: string | null;
  summary: string;
  nextStep: string | null;
  commitHash: string | null;
  commitUrl: string | null;
}

/** A change log entry as the ops layer returns it, with an ISO timestamp. */
export interface ChangeLike extends ChangeFacts, TimelineAuthor {
  id: number;
  systemId: string | null;
  createdAt: string;
}

/** Turns progress updates into timeline items. */
export function updateItems(updates: UpdateLike[]): UpdateTimelineItem[] {
  return updates.map(({ id, ...u }) => ({ kind: "update", key: `u-${id}`, ...u }));
}

/**
 * Turns change log entries into timeline sentences. Posted updates are left
 * out (the update itself is shown instead); ADRs are named from their
 * "created" entries in the same list.
 *
 * @param systems the project's systems by id, to name and link them
 * @param columns the category of each "Board / Column", to colour moves
 */
export function changeItems(
  entries: ChangeLike[],
  systems: Map<string, { slug: string; title: string }>,
  columns: Map<string, ColumnCategory> = new Map(),
): ChangeTimelineItem[] {
  const adrLabels = new Map<string, string>();
  for (const e of entries) {
    const match = e.entity === "adr" && e.field === "created" ? /^ADR (\d+): (.*)$/.exec(e.newValue ?? "") : null;
    if (match) adrLabels.set(e.entityId, `ADR-${match[1]} ${match[2]}`);
  }
  return entries
    .filter((e) => e.entity !== "update")
    .map((e) => {
      const system = e.systemId ? systems.get(e.systemId) : undefined;
      const sentence = describeChange(e, { systemTitle: system?.title ?? null, adrLabel: adrLabels.get(e.entityId) ?? null });
      const toCategory = e.entity === "system" && e.field === "column" && e.newValue ? (columns.get(e.newValue) ?? null) : null;
      return {
        kind: "change",
        key: `c-${e.id}`,
        createdAt: e.createdAt,
        authorName: e.authorName,
        agent: e.agent,
        sentence,
        systemSlug: system?.slug ?? null,
        toCategory,
      };
    });
}

/** Merges timeline items newest first and groups them by day label. */
function groupByDay(items: TimelineItem[], now: Date = new Date()): { label: string; items: TimelineItem[] }[] {
  const sorted = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const groups: { label: string; items: TimelineItem[] }[] = [];
  for (const item of sorted) {
    const label = dayLabel(item.createdAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

/** The system name in a sentence, linked when the system still exists. */
function SystemLink({ projectSlug, slug, title }: { projectSlug: string; slug: string | null; title: string }) {
  if (!slug || !projectSlug) return <span className="font-medium">{title}</span>;
  return (
    <Link href={`/p/${projectSlug}/systems/${slug}`} className="font-medium hover:underline">
      {title}
    </Link>
  );
}

/** One row of the timeline: avatar, sentence, details and time. */
function TimelineRow({ item, projectSlug, hideSystem }: { item: TimelineItem; projectSlug: string; hideSystem: boolean }) {
  const { authorName: name, agent } = item;
  return (
    <li tabIndex={0} data-nav-item className="flex gap-3 border-b px-4 py-3 outline-none last:border-b-0 focus-visible:bg-muted/50">
      <PersonAvatar name={name} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[13.5px] leading-[1.45]">
          <span className="font-semibold">{name}</span>
          {agent && <AgentTag agent={agent} className="self-center" />}
          {item.kind === "update" ? (
            hideSystem ? (
              <span className="text-fg-2">posted an update</span>
            ) : (
              <>
                <span className="text-fg-2">posted an update on</span>
                <SystemLink projectSlug={projectSlug} slug={item.systemSlug} title={item.systemTitle} />
              </>
            )
          ) : (
            <ChangeText item={item} projectSlug={projectSlug} />
          )}
        </p>
        {item.kind === "update" && (
          <>
            <div className="bg-secondary px-3 py-2.5">
              <Markdown className="max-w-none! text-[13.5px]! leading-[1.55]!">{item.summary}</Markdown>
            </div>
            {item.nextStep && (
              <p className="text-[13px] text-fg-2">
                <span className="font-medium text-foreground">Next:</span> {item.nextStep}
              </p>
            )}
            {(item.taskTitle || item.commitHash) && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {item.taskTitle && <span>Task: {item.taskTitle}</span>}
                {item.commitHash &&
                  (item.commitUrl ? (
                    <a href={item.commitUrl} target="_blank" rel="noreferrer noopener" className="font-mono text-[11.5px] text-brand-strong hover:underline">
                      {item.commitHash.slice(0, 7)}
                    </a>
                  ) : (
                    <span className="font-mono text-[11.5px] text-brand-strong">{item.commitHash.slice(0, 7)}</span>
                  ))}
              </p>
            )}
          </>
        )}
      </div>
      <time dateTime={item.createdAt} title={`${formatDate(item.createdAt)} ${formatTime(item.createdAt)} UTC`} className="text-xs whitespace-nowrap text-muted-foreground">
        {formatTime(item.createdAt)}
        <span className="text-muted-foreground/70"> UTC</span>
      </time>
    </li>
  );
}

/** The sentence of a change: verb, target and an optional from → to. */
function ChangeText({ item, projectSlug }: { item: ChangeTimelineItem; projectSlug: string }) {
  const { verb, target, targetIsSystem, from, to } = item.sentence;
  return (
    <>
      <span className="text-fg-2">{verb}</span>
      {target &&
        (targetIsSystem ? (
          <SystemLink projectSlug={projectSlug} slug={item.systemSlug} title={target} />
        ) : (
          <span className="font-medium">{target}</span>
        ))}
      {to !== undefined && (
        <span className="inline-flex flex-wrap items-center gap-1.5 text-fg-2">
          {from !== undefined && (
            <>
              {from}
              <ArrowRight aria-label="to" className="size-3" />
            </>
          )}
          <span className={cn("font-semibold", item.toCategory ? CATEGORY_TEXT[item.toCategory] : "text-foreground")}>{to}</span>
        </span>
      )}
    </>
  );
}

/**
 * Renders timeline items grouped by day ("Today", "Yesterday", dates), each
 * day a bordered list, newest first.
 *
 * @param props.hideSystem say "posted an update" without naming the system (on a system's own page)
 */
export function Timeline({ items, projectSlug, hideSystem = false }: { items: TimelineItem[]; projectSlug: string; hideSystem?: boolean }) {
  const now = useNow();
  return (
    <div className="flex flex-col gap-5">
      {groupByDay(items, now).map((day) => (
        <section key={day.label} className="flex flex-col gap-2">
          <h2 title="Days in UTC" className="text-xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{day.label}</h2>
          <ol className="flex flex-col border bg-card">
            {day.items.map((item) => (
              <TimelineRow key={item.key} item={item} projectSlug={projectSlug} hideSystem={hideSystem} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
