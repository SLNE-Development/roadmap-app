import { plural } from "@/lib/text";
import { HEALTH_QUIET_DAYS, STALE_SYSTEM_DAYS } from "@/lib/ops/attention";

const DAY_MS = 86_400_000;

/** How a project is doing, for the badge on its home card. */
export type HealthStatus = "on-track" | "at-risk" | "stalled" | "empty";

/** The numbers {@link projectHealth} judges. */
export interface HealthInput {
  systems: number;
  /** Systems outside the done category. */
  notDone: number;
  blocked: number;
  activeOrReview: number;
  /** Active or review systems without activity for {@link STALE_SYSTEM_DAYS} days. */
  staleSystems: number;
  blockingQuestions: number;
  lastChange: Date | null;
  now: Date;
}

/** The status of a project and the reasons behind it. */
export interface ProjectHealth {
  status: HealthStatus;
  reasons: string[];
}

/**
 * Rates a project: `empty` without systems, `on-track` when all is done,
 * `stalled` when it has been quiet for {@link HEALTH_QUIET_DAYS} days or half
 * of its active work has gone quiet, `at-risk` when work is blocked or stale or
 * blocking questions are open, otherwise `on-track`.
 */
export function projectHealth(input: HealthInput): ProjectHealth {
  const { systems, notDone, blocked, activeOrReview, staleSystems, blockingQuestions, lastChange, now } = input;
  if (systems === 0) return { status: "empty", reasons: [] };
  if (notDone === 0) return { status: "on-track", reasons: ["Everything is done."] };

  const stalled: string[] = [];
  const quietDays = lastChange === null ? null : (now.getTime() - lastChange.getTime()) / DAY_MS;
  if (quietDays === null || quietDays >= HEALTH_QUIET_DAYS) {
    stalled.push(`No changes for ${quietDays === null ? `more than ${HEALTH_QUIET_DAYS} days` : plural(Math.floor(quietDays), "day")}.`);
  }
  if (activeOrReview > 0 && staleSystems / activeOrReview >= 0.5) {
    stalled.push(`${staleSystems} of ${plural(activeOrReview, "system")} in progress ${activeOrReview === 1 ? "has" : "have"} gone quiet.`);
  }
  if (stalled.length > 0) return { status: "stalled", reasons: stalled };

  const risks: string[] = [];
  if (blocked >= 1 && blocked / notDone >= 0.2) risks.push(`${blocked} of ${plural(notDone, "open system")} ${notDone === 1 ? "is" : "are"} blocked.`);
  if (staleSystems >= 1) risks.push(`${plural(staleSystems, "system")} ${staleSystems === 1 ? "has" : "have"} had no update for ${STALE_SYSTEM_DAYS}+ days.`);
  if (blockingQuestions >= 1) risks.push(`${plural(blockingQuestions, "blocking question")} ${blockingQuestions === 1 ? "is" : "are"} open.`);
  return risks.length > 0 ? { status: "at-risk", reasons: risks } : { status: "on-track", reasons: [] };
}
