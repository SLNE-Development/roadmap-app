import Link from "next/link";
import { describeChange } from "@/components/activity/change-sentence";
import { cn } from "@/lib/utils";
import type { CallRow } from "@/lib/ops/agent-runs";
import type { HistoryEntry } from "@/lib/ops/activity";

/** Tools that only read; every other tool changes something. */
const READ_TOOL = /^(get|list|search|my_work)/;

/** Formats the UTC time of day of `date` as "09:05:07". */
function formatClock(date: Date): string {
  return date.toISOString().slice(11, 19);
}

/** What a call did: failed, read or wrote. */
function callKind(call: CallRow): "error" | "read" | "write" {
  if (!call.ok) return "error";
  return READ_TOOL.test(call.tool) ? "read" : "write";
}

/** The dot colour and accessible label of each call kind. */
const KIND = {
  read: { dot: "bg-cat-todo", label: "Read" },
  write: { dot: "bg-cat-active", label: "Write" },
  error: { dot: "bg-cat-blocked", label: "Error" },
} as const;

/**
 * A run's calls in time order: time, tool in mono, target, duration and a dot for
 * read, write or error; a failed call shows its error message below.
 */
export function CallTimeline({ calls }: { calls: CallRow[] }) {
  return (
    <ol className="flex flex-col border bg-card">
      {calls.map((call) => {
        const kind = KIND[callKind(call)];
        return (
          <li key={call.id} className="flex flex-col gap-1 border-b px-3 py-2 last:border-b-0">
            <div className="flex items-center gap-2.5 text-[12.5px]">
              <span className={cn("size-2 shrink-0 rounded-full", kind.dot)} role="img" aria-label={kind.label} />
              <time dateTime={call.at.toISOString()} title="UTC" className="font-mono text-xs text-muted-foreground">
                {formatClock(call.at)} UTC
              </time>
              <span className="font-mono font-medium">{call.tool}</span>
              <span className="min-w-0 flex-1 truncate text-fg-2">{call.target ?? call.systemSlug}</span>
              <span className="font-mono text-xs text-muted-foreground">{call.durationMs} ms</span>
            </div>
            {call.error && <p className="pl-[18px] text-xs text-cat-blocked">{call.error}</p>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The changes made while a run ran, as sentences; each links to the project's
 * activity filtered to the agents' changes of its system.
 *
 * @param props.systems the project's systems by id, to name them
 */
export function ChangedList({ changes, projectSlug, systems }: { changes: HistoryEntry[]; projectSlug: string; systems: Map<string, { slug: string; title: string }> }) {
  return (
    <ul className="flex flex-col border bg-card">
      {changes.map((change) => {
        const system = change.systemId ? systems.get(change.systemId) : undefined;
        const { verb, target, from, to } = describeChange(change, { systemTitle: system?.title ?? null });
        const href = `/p/${projectSlug}/activity?agents=1${system ? `&system=${system.slug}` : ""}`;
        return (
          <li key={change.id} className="border-b last:border-b-0">
            <Link href={href} className="flex flex-wrap items-baseline gap-x-1.5 px-3 py-2 text-[13px] outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
              <span className="text-fg-2">{verb}</span>
              {target && <span className="font-medium">{target}</span>}
              {to !== undefined && (
                <span className="text-fg-2">
                  {from !== undefined && `${from} → `}
                  <span className="font-semibold text-foreground">{to}</span>
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
