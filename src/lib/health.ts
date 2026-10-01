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

/** One reason behind a health status: a code with the numbers the UI words it with (`home.health.*`). */
export type HealthReason =
  | { code: "allDone" }
  /** `days` is null when the project has never changed; `limit` is {@link HEALTH_QUIET_DAYS}. */
  | { code: "noChanges"; days: number | null; limit: number }
  | { code: "quietProgress"; stale: number; total: number }
  | { code: "blocked"; blocked: number; open: number }
  | { code: "staleSystems"; count: number; days: number }
  | { code: "blockingQuestions"; count: number };

/** The status of a project and the reasons behind it. */
export interface ProjectHealth {
  status: HealthStatus;
  reasons: HealthReason[];
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
  if (notDone === 0) return { status: "on-track", reasons: [{ code: "allDone" }] };

  const stalled: HealthReason[] = [];
  const quietDays = lastChange === null ? null : (now.getTime() - lastChange.getTime()) / DAY_MS;
  if (quietDays === null || quietDays >= HEALTH_QUIET_DAYS) {
    stalled.push({ code: "noChanges", days: quietDays === null ? null : Math.floor(quietDays), limit: HEALTH_QUIET_DAYS });
  }
  if (activeOrReview > 0 && staleSystems / activeOrReview >= 0.5) {
    stalled.push({ code: "quietProgress", stale: staleSystems, total: activeOrReview });
  }
  if (stalled.length > 0) return { status: "stalled", reasons: stalled };

  const risks: HealthReason[] = [];
  if (blocked >= 1 && blocked / notDone >= 0.2) risks.push({ code: "blocked", blocked, open: notDone });
  if (staleSystems >= 1) risks.push({ code: "staleSystems", count: staleSystems, days: STALE_SYSTEM_DAYS });
  if (blockingQuestions >= 1) risks.push({ code: "blockingQuestions", count: blockingQuestions });
  return risks.length > 0 ? { status: "at-risk", reasons: risks } : { status: "on-track", reasons: [] };
}
