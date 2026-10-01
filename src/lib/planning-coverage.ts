import { PLANNING_AREAS, type PlanningArea } from "@/db/schema";
import type { PlanningItemView } from "@/lib/ops/planning";
import { plural } from "@/lib/text";

/** Settled questions an area needs before it stops counting as thin. */
export const THIN_MIN_SETTLED = 2;

/** How well one planning area is covered by the questions asked so far. */
export interface AreaCoverage {
  area: PlanningArea;
  asked: number;
  answered: number;
  acceptedRisk: number;
  open: number;
  risks: number;
  thin: boolean;
  reason: string | null;
}

/**
 * Measures how thoroughly each planning area was interviewed. A question is
 * settled when it is answered or an accepted risk. Coverage is advisory: only
 * `planningGaps` blocks completing planning.
 *
 * @returns one entry per area, in {@link PLANNING_AREAS} order
 */
export function planningCoverage(items: Pick<PlanningItemView, "area" | "status" | "isRisk">[]): AreaCoverage[] {
  return PLANNING_AREAS.map((area) => {
    const own = items.filter((i) => i.area === area);
    const answered = own.filter((i) => i.status === "answered").length;
    const acceptedRisk = own.filter((i) => i.status === "accepted-risk").length;
    const open = own.filter((i) => i.status === "open").length;
    const risks = own.filter((i) => i.isRisk).length;
    const settled = answered + acceptedRisk;
    let reason: string | null = null;
    if (own.length === 0) reason = "No questions asked yet.";
    else if (settled < THIN_MIN_SETTLED) reason = `Only ${plural(settled, "settled question")}; ask at least ${THIN_MIN_SETTLED}.`;
    else if (area === "failure-modes" && risks === 0) reason = "No failure mode is flagged as a risk.";
    return { area, asked: own.length, answered, acceptedRisk, open, risks, thin: reason !== null, reason };
  });
}
