import type { ChangeTimelineItem, TimelineItem } from "./timeline";

/** A burst of changes by one author, folded into one row. */
export interface FoldedGroup {
  kind: "fold";
  /** `f-<key of the newest item>`. */
  key: string;
  authorName: string;
  agent: string | null;
  /** The folded changes, newest first. */
  items: ChangeTimelineItem[];
  /** The distinct systems the changes touch, in order of first appearance. */
  systemTitles: string[];
  /** ISO time of the oldest change. */
  from: string;
  /** ISO time of the newest change. */
  to: string;
}

/** The title of the system a change belongs to, when it names one. */
function systemTitleOf(item: ChangeTimelineItem): string | null {
  return item.systemTitle ?? (item.sentence.targetIsSystem ? item.sentence.target : null);
}

/** The UTC day of an ISO timestamp as `YYYY-MM-DD`. */
function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * Folds bursts of changes by the same author into one group each, so a single
 * agent run does not drown the timeline.
 *
 * - The input is sorted newest first.
 * - A run is a maximal sequence of `change` items with the same `authorName`
 *   and `agent`, where each item is within `windowMs` of its neighbour and all
 *   fall on the same UTC day.
 * - An `update` item always breaks a run and is never folded.
 * - Runs shorter than `minRun` stay as they are.
 *
 * @param opts.windowMs the largest gap between neighbours in a run, default 300_000 (5 minutes)
 * @param opts.minRun the shortest run that is folded, default 3
 */
export function foldActivity(items: TimelineItem[], opts: { windowMs?: number; minRun?: number } = {}): (TimelineItem | FoldedGroup)[] {
  const { windowMs = 300_000, minRun = 3 } = opts;
  const out: (TimelineItem | FoldedGroup)[] = [];
  let run: ChangeTimelineItem[] = [];
  const flush = () => {
    if (run.length >= minRun) {
      const titles = run.map(systemTitleOf).filter((t): t is string => t !== null);
      out.push({
        kind: "fold",
        key: `f-${run[0].key}`,
        authorName: run[0].authorName,
        agent: run[0].agent,
        items: run,
        systemTitles: [...new Set(titles)],
        from: run[run.length - 1].createdAt,
        to: run[0].createdAt,
      });
    } else out.push(...run);
    run = [];
  };
  for (const item of items) {
    if (item.kind !== "change") {
      flush();
      out.push(item);
      continue;
    }
    const prev = run.at(-1);
    const continues =
      prev &&
      prev.authorName === item.authorName &&
      prev.agent === item.agent &&
      new Date(prev.createdAt).getTime() - new Date(item.createdAt).getTime() <= windowMs &&
      utcDay(prev.createdAt) === utcDay(item.createdAt);
    if (prev && !continues) flush();
    run.push(item);
  }
  flush();
  return out;
}
