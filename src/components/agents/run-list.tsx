import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { PersonAvatar } from "@/components/person-avatar";
import type { RunSummary } from "@/lib/ops/agent-runs";
import { cn } from "@/lib/utils";

/** Formats a token count compactly, "1.2M"; `locale` picks the language of the suffix and separators. */
export function formatTokens(n: number, locale = "en"): string {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
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
  const t = useTranslations("activity.agents");
  return (
    <span role="img" aria-label={t("live")} className="relative flex size-2 shrink-0">
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
  const t = useTranslations("activity.agents");
  const locale = useLocale();
  return (
    <ul className="flex flex-col border bg-card">
      {runs.map((run) => (
        <li key={run.id} className="border-b last:border-b-0">
          <Link href={hrefFor(run.id)} scroll={false} className="flex items-center gap-3 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:bg-muted/50">
            <PersonAvatar name={run.userName} size="md" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className={cn("truncate text-[13.5px] font-semibold", !run.title && "text-fg-2")}>{run.title ?? t("untitledRun")}</span>
                {run.live && <LiveDot />}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {run.userName}
                {run.repo && <span className="font-mono"> · {run.repo}{run.branch ? `@${run.branch}` : ""}</span>}
              </span>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-fg-2 sm:flex-row sm:items-center sm:gap-4">
              <span>{t("calls", { count: run.callCount })}</span>
              {run.errorCount > 0 && <span className="font-medium text-cat-blocked">{t("errors", { count: run.errorCount })}</span>}
              <span title={t("duration")}>{formatDuration(run.startedAt, run.lastCallAt)}</span>
              {run.tokens && (
                <span title={t("tokensTitle")}>
                  {t("tokens", { tokens: formatTokens(run.tokens.input + run.tokens.output + run.tokens.cacheWrite, locale) })}
                </span>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
