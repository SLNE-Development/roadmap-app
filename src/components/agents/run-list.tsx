import Link from "next/link";
import { PersonAvatar } from "@/components/person-avatar";
import type { RunSummary } from "@/lib/ops/agent-runs";
import { plural } from "@/lib/text";
import { cn } from "@/lib/utils";

/** Compact token counts such as "1.2M". */
const COMPACT = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** Formats a token count compactly, "1.2M". */
export function formatTokens(n: number): string {
  return COMPACT.format(n);
}

/** Formats the time between two instants as "45s", "4m 12s" or "1h 05m". */
export function formatDuration(from: Date, to: Date): string {
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A pulsing dot for a run that is live. */
function LiveDot() {
  return (
    <span role="img" aria-label="Live" className="relative flex size-2 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-cat-done opacity-60 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-cat-done" />
    </span>
  );
}

/**
 * The runs of the agents page, newest first: avatar, title, person, calls, errors,
 * duration, a live dot and tokens. Each row opens the run's detail.
 *
 * @param props.runs the runs to show
 * @param props.hrefFor the link of a run's detail
 */
export function RunList({ runs, hrefFor }: { runs: RunSummary[]; hrefFor: (runId: string) => string }) {
  return (
    <ul className="flex flex-col border bg-card">
      {runs.map((run) => (
        <li key={run.id} className="border-b last:border-b-0">
          <Link href={hrefFor(run.id)} scroll={false} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
            <PersonAvatar name={run.userName} size="md" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className={cn("truncate text-[13.5px] font-semibold", !run.title && "text-fg-2")}>{run.title ?? "Untitled run"}</span>
                {run.live && <LiveDot />}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {run.userName}
                {run.repo && <span className="font-mono"> · {run.repo}{run.branch ? `@${run.branch}` : ""}</span>}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-fg-2 sm:flex-row sm:items-center sm:gap-4">
              <span>{plural(run.callCount, "call")}</span>
              {run.errorCount > 0 && <span className="font-medium text-cat-blocked">{plural(run.errorCount, "error")}</span>}
              <span title="Duration">{formatDuration(run.startedAt, run.lastCallAt)}</span>
              {run.tokens && (
                <span title="Run total: input, output and cache write tokens">
                  {formatTokens(run.tokens.input + run.tokens.output + run.tokens.cacheWrite)} tokens (run total)
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
