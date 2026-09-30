import { GitCommitHorizontal, History } from "lucide-react";
import { STATE_LABEL } from "@/components/chips";
import { Markdown } from "@/components/markdown";
import { EmptyState } from "@/components/page";
import type { TaskState } from "@/db/schema";
import type { HistoryEntry } from "@/lib/ops/activity";
import type { UpdateItem } from "@/lib/ops/updates";
import { dayLabel, formatTime } from "@/lib/time";
import { AuthorBadge } from "./author";

/** Names that change sentences need: task titles by id, and domain and phase names by id. */
export interface ActivityNames {
  tasks: Map<string, string>;
  domains: Map<string, string>;
  phases: Map<string, string>;
}

/** One entry of the merged feed. */
type FeedItem = { kind: "update"; at: Date; update: UpdateItem } | { kind: "change"; at: Date; change: HistoryEntry };

/** Drops a "Board / " prefix both values share, so a move within a board names only the columns. */
function columnNames(from: string | null, to: string | null): [string, string] {
  const split = (v: string | null) => (v ?? "").split(" / ");
  const [fb, fc] = split(from);
  const [tb, tc] = split(to);
  if (fc !== undefined && tc !== undefined && fb === tb) return [fc, tc];
  return [from ?? "nowhere", to ?? "nowhere"];
}

/** Quotes a title in typographic quotes. */
function q(text: string | null | undefined): string {
  return `“${text ?? "a task"}”`;
}

/** Describes a change log entry as the end of a sentence that starts with its author. */
export function describeChange(e: HistoryEntry, names: ActivityNames): string {
  const task = names.tasks.get(e.entityId);
  switch (`${e.entity}.${e.field}`) {
    case "system.created":
      return "created the system";
    case "system.column": {
      const [from, to] = columnNames(e.oldValue, e.newValue);
      return `moved it from ${from} to ${to}`;
    }
    case "system.priority":
      return `changed the priority from ${e.oldValue} to ${e.newValue}`;
    case "system.owner":
      return e.newValue ? `made ${e.newValue} the owner` : `removed ${e.oldValue ?? "the owner"} as owner`;
    case "system.title":
      return `renamed it from ${q(e.oldValue)} to ${q(e.newValue)}`;
    case "system.summary":
      return "edited the summary";
    case "system.notes":
      return "edited the notes";
    case "system.domainId":
      return e.newValue ? `set the domain to ${names.domains.get(e.newValue) ?? "a removed domain"}` : "cleared the domain";
    case "system.phaseId":
      return e.newValue ? `set the phase to ${names.phases.get(e.newValue) ?? "a removed phase"}` : "cleared the phase";
    case "task.created":
      return `added the task ${q(e.newValue)}`;
    case "task.deleted":
      return `deleted the task ${q(e.oldValue)}`;
    case "task.title":
      return `renamed the task ${q(e.oldValue)} to ${q(e.newValue)}`;
    case "task.state":
      return `set ${q(task)} to ${STATE_LABEL[e.newValue as TaskState] ?? e.newValue}`;
    case "task.priority":
      return `changed the priority of ${q(task)} to ${e.newValue}`;
    case "task.owner":
      return e.newValue ? `assigned ${q(task)} to ${e.newValue}` : `unassigned ${q(task)}`;
    case "planning.round": {
      const m = /^round (\d+): (\d+) questions$/.exec(e.newValue ?? "");
      return m ? `asked planning round ${m[1]} (${m[2]} ${m[2] === "1" ? "question" : "questions"})` : "asked a planning round";
    }
    case "planning.answers": {
      const n = Number.parseInt(e.newValue ?? "", 10);
      return Number.isFinite(n) ? `recorded ${n} planning ${n === 1 ? "answer" : "answers"}` : "recorded planning answers";
    }
    case "planning.completed":
      return "completed planning";
    case "planning.reopened":
      return "reopened planning";
    case "document.spec":
      return `wrote spec ${e.newValue ?? ""}`.trim();
    case "document.plan":
      return `wrote plan ${e.newValue ?? ""}`.trim();
    case "question.created":
      return `asked ${q(e.newValue)}`;
    case "question.answer":
      return "answered a question";
    case "question.resolved":
      return e.newValue === "true" ? "resolved a question" : "reopened a question";
    default:
      return `changed ${e.entity} ${e.field}`;
  }
}

/** A progress update in the feed: author, summary, next step, task and commit. */
function UpdateEntry({ update: u }: { update: UpdateItem }) {
  return (
    <div className="flex flex-col gap-2 border bg-card px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <AuthorBadge label={u.author} />
        <span className="text-muted-foreground">posted an update</span>
        <time className="ml-auto text-xs text-muted-foreground tabular-nums" dateTime={u.createdAt.toISOString()}>
          {formatTime(u.createdAt.toISOString())}
        </time>
      </div>
      <Markdown className="text-sm">{u.summary}</Markdown>
      {u.nextStep && (
        <p className="text-[13px] text-fg-2">
          <span className="font-medium text-foreground">Next:</span> {u.nextStep}
        </p>
      )}
      {(u.taskTitle || u.commitHash) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-fg-2">
          {u.taskTitle && <span>Task {q(u.taskTitle)}</span>}
          {u.commitHash &&
            (u.commitUrl ? (
              <a
                href={u.commitUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-mono text-brand-strong hover:underline"
                aria-label={`Commit ${u.commitHash.slice(0, 7)}`}
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
function ChangeEntry({ change: e, names }: { change: HistoryEntry; names: ActivityNames }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 text-[13px]">
      <AuthorBadge label={e.author} />
      <span className="min-w-0 flex-1 text-fg-2">{describeChange(e, names)}</span>
      <time className="text-xs text-muted-foreground tabular-nums" dateTime={e.createdAt.toISOString()}>
        {formatTime(e.createdAt.toISOString())}
      </time>
    </div>
  );
}

/**
 * The system's activity, newest first and grouped by day: progress updates as
 * cards and changes as sentences. Update postings in the change log are left
 * out because the updates themselves are shown.
 */
export function ActivityFeed({ updates, changes, names }: { updates: UpdateItem[]; changes: HistoryEntry[]; names: ActivityNames }) {
  const items: FeedItem[] = [
    ...updates.map((u) => ({ kind: "update" as const, at: u.createdAt, update: u })),
    ...changes.map((c) => ({ kind: "change" as const, at: c.createdAt, change: c })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());
  if (items.length === 0) {
    return <EmptyState icon={<History />} title="No activity yet" description="Updates from agents and every change to this system show up here." />;
  }
  const days: { label: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const label = dayLabel(item.at.toISOString());
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days[days.length - 1].items.push(item);
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map((d) => (
        <section key={d.label} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{d.label}</h2>
          <ol className="flex flex-col gap-2">
            {d.items.map((item) => (
              <li key={item.kind === "update" ? `u-${item.update.id}` : `c-${item.change.id}`}>
                {item.kind === "update" ? <UpdateEntry update={item.update} /> : <ChangeEntry change={item.change} names={names} />}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
