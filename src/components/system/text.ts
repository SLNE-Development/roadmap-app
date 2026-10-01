import { useFormatter, useTranslations } from "next-intl";
import { useNow } from "@/components/clock";
import type { PlanningArea, PlanningItemStatus } from "@/db/schema";

/*
 * Plain-language helpers of the system page, shared by its server and client parts.
 */

/** The `enums.planningArea` key of each planning area. */
const AREA_KEY = {
  "failure-modes": "failureModes",
  dependencies: "dependencies",
  scope: "scope",
  "ops-testing": "opsTesting",
} as const;

/** Returns the `enums.planningArea` message key of a planning area. */
export function areaKey(area: PlanningArea): (typeof AREA_KEY)[PlanningArea] {
  return AREA_KEY[area];
}

/** The `planning.itemStatus` key of each planning item state. */
const ITEM_STATUS_KEY = { open: "open", answered: "answered", "accepted-risk": "acceptedRisk" } as const;

/** Returns the `planning.itemStatus` message key of a planning item state. */
export function itemStatusKey(status: PlanningItemStatus): (typeof ITEM_STATUS_KEY)[PlanningItemStatus] {
  return ITEM_STATUS_KEY[status];
}

/** Text colour of each planning item state. */
export const ITEM_STATUS_TEXT: Record<PlanningItemStatus, string> = {
  open: "text-cat-planning",
  answered: "text-cat-done",
  "accepted-risk": "text-cat-review",
};

/**
 * Returns a function that formats a date as "12 Sep" ("12. Sep." in German), adding the year when it
 * differs from the render clock's, in the user's time zone.
 */
export function useShortDate(): (date: Date) => string {
  const format = useFormatter();
  const now = useNow();
  return (date) =>
    format.dateTime(
      date,
      format.dateTime(date, { year: "numeric" }) === format.dateTime(now, { year: "numeric" })
        ? { day: "numeric", month: "short" }
        : { day: "numeric", month: "short", year: "numeric" },
    );
}

/** Returns a planning area by the slug the ops layer's gap messages use, or `null` for an unknown one. */
function areaOf(slug: string): PlanningArea | null {
  return slug in AREA_KEY ? (slug as PlanningArea) : null;
}

/**
 * Returns the functions that turn the planning gaps reported by the ops layer (English
 * sentences) into the reader's language: {@link describe} makes one sentence, such as
 * "scope and ops and testing have no answer yet; 2 questions are still open",
 * {@link stillInPlanning} puts that sentence after "Still in planning:", and {@link line} makes one short line for a list. Gaps the helpers do not know pass through.
 */
export function useGapText() {
  const t = useTranslations("system.gaps");
  const format = useFormatter();
  const describe = (gaps: string[]): string => {
    const areas: string[] = [];
    let open = 0;
    let noSpec = false;
    const other: string[] = [];
    for (const gap of gaps) {
      const m = /^Area (\S+) has no answered item\.$/.exec(gap);
      const area = m && areaOf(m[1]);
      if (area) areas.push(t(`areaNames.${areaKey(area)}`));
      else if (m) other.push(gap);
      else if (gap.startsWith("Item ")) open++;
      else if (gap.startsWith("No spec")) noSpec = true;
      else other.push(gap);
    }
    const parts: string[] = [];
    if (areas.length) parts.push(t(areas.length === 1 ? "areaNoAnswerOne" : "areasNoAnswer", { areas: format.list(areas, { type: "conjunction" }) }));
    if (open) parts.push(t("questionsOpen", { count: open }));
    if (noSpec) parts.push(t("noSpec"));
    parts.push(...other);
    return parts.length ? parts.join("; ") : t("notComplete");
  };
  const line = (gap: string): string => {
    const m = /^Area (\S+) has no answered item\.$/.exec(gap);
    const area = m && areaOf(m[1]);
    if (area) return t("areaNoAnswer", { area: t(`areaNames.${areaKey(area)}`) });
    const item = /^Item \S+ is still open: "(.*)"\.$/.exec(gap);
    if (item) return t("openQuestion", { title: item[1] });
    if (gap.startsWith("No spec")) return t("noSpecYet");
    return gap;
  };
  const stillInPlanning = (gaps: string[]): string => t("stillInPlanning", { gaps: describe(gaps) });
  return { describe, line, stillInPlanning };
}
