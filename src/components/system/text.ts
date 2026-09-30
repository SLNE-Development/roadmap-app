import type { PlanningArea, PlanningItemStatus } from "@/db/schema";

/*
 * Plain-language helpers of the system page, shared by its server and client parts.
 */

/** Display names of planning areas. */
export const AREA_LABEL: Record<PlanningArea, string> = {
  "failure-modes": "Failure modes",
  dependencies: "Dependencies",
  scope: "Scope",
  "ops-testing": "Ops and testing",
};

/** Display names of planning item states. */
export const ITEM_STATUS_LABEL: Record<PlanningItemStatus, string> = {
  open: "Open",
  answered: "Answered",
  "accepted-risk": "Accepted risk",
};

/** Text colour of each planning item state. */
export const ITEM_STATUS_TEXT: Record<PlanningItemStatus, string> = {
  open: "text-cat-planning",
  answered: "text-cat-done",
  "accepted-risk": "text-cat-review",
};

/** Joins words as "a", "a and b" or "a, b and c". */
function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Turns the planning gaps reported by the ops layer into one sentence, such as
 * "scope and ops testing have no answer yet; 2 questions are still open".
 */
export function describeGaps(gaps: string[]): string {
  const areas: string[] = [];
  let open = 0;
  let noSpec = false;
  const other: string[] = [];
  for (const gap of gaps) {
    const area = /^Area (\S+) has no answered item\.$/.exec(gap);
    if (area) areas.push((AREA_LABEL[area[1] as PlanningArea] ?? area[1]).toLowerCase());
    else if (gap.startsWith("Item ")) open++;
    else if (gap.startsWith("No spec")) noSpec = true;
    else other.push(gap);
  }
  const parts: string[] = [];
  if (areas.length) parts.push(`${joinWords(areas)} ${areas.length === 1 ? "has" : "have"} no answer yet`);
  if (open) parts.push(`${open} ${open === 1 ? "question is" : "questions are"} still open`);
  if (noSpec) parts.push("no spec has been written");
  parts.push(...other);
  return parts.length ? parts.join("; ") : "the planning interview is not complete";
}

/**
 * Turns one planning gap into a short human line for a list: the area, the
 * open question, or the missing spec.
 */
export function gapLine(gap: string): string {
  const area = /^Area (\S+) has no answered item\.$/.exec(gap);
  if (area) return `${AREA_LABEL[area[1] as PlanningArea] ?? area[1]} has no answer yet`;
  const item = /^Item \S+ is still open: "(.*)"\.$/.exec(gap);
  if (item) return `Open question: ${item[1]}`;
  if (gap.startsWith("No spec")) return "No spec has been written yet";
  return gap;
}
