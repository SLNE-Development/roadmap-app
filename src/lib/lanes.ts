import { PRIORITIES } from "@/db/schema";
import type { BoardCardView } from "@/lib/board-card";

/** How the board groups its cards into swimlanes. */
export const LANE_KEYS = ["none", "domain", "phase", "owner", "priority"] as const;
export type LaneKey = (typeof LANE_KEYS)[number];

/** The `Lane.key` of cards without a domain, phase or owner. */
export const NO_LANE = "__none";

/** One swimlane: the cards sharing a group value, with their count per column. */
export interface Lane {
  /** The group value, `"__none"` for "No domain", "No phase" or "Unassigned", `"all"` without lanes. */
  key: string;
  name: string;
  cards: BoardCardView[];
  countByColumn: Record<string, number>;
}

/** Names and structure order the lanes are built from. */
export interface LaneNames {
  domains: Map<string, string>;
  phases: Map<string, string>;
  phaseOrder: string[];
  domainOrder: string[];
}

/** Builds a lane and counts its cards per column. */
function lane(key: string, name: string, cards: BoardCardView[]): Lane {
  const countByColumn: Record<string, number> = {};
  for (const c of cards) countByColumn[c.columnId] = (countByColumn[c.columnId] ?? 0) + 1;
  return { key, name, cards, countByColumn };
}

/**
 * Groups cards into swimlanes. Domain and phase lanes follow the structure order,
 * owner lanes sort by name, priority lanes follow `PRIORITIES`; the lane for cards
 * without a value comes last. Lanes without cards are left out.
 */
export function groupIntoLanes(cards: BoardCardView[], by: LaneKey, names: LaneNames): Lane[] {
  if (by === "none") return [lane("all", "", cards)];

  const groups = new Map<string, BoardCardView[]>();
  const labels = new Map<string, string>();
  for (const c of cards) {
    let key: string;
    let label: string;
    if (by === "domain") {
      key = c.domainId ?? NO_LANE;
      label = c.domainId ? (names.domains.get(c.domainId) ?? "Unknown domain") : "No domain";
    } else if (by === "phase") {
      key = c.phaseId ?? NO_LANE;
      label = c.phaseId ? (names.phases.get(c.phaseId) ?? "Unknown phase") : "No phase";
    } else if (by === "owner") {
      key = c.ownerUserId ?? NO_LANE;
      label = c.ownerUserId ? (c.ownerName ?? "Unknown") : "Unassigned";
    } else {
      key = c.priority;
      label = c.priority;
    }
    groups.set(key, [...(groups.get(key) ?? []), c]);
    labels.set(key, label);
  }

  const keys = [...groups.keys()].filter((k) => k !== NO_LANE);
  if (by === "owner") keys.sort((a, b) => labels.get(a)!.localeCompare(labels.get(b)!));
  else if (by === "priority") keys.sort((a, b) => PRIORITIES.indexOf(a as never) - PRIORITIES.indexOf(b as never));
  else {
    const order = by === "domain" ? names.domainOrder : names.phaseOrder;
    // Ids missing from the structure order (should not happen) go after it, in card order.
    const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
    keys.sort((a, b) => rank(a) - rank(b));
  }
  if (groups.has(NO_LANE)) keys.push(NO_LANE);
  return keys.map((k) => lane(k, labels.get(k)!, groups.get(k)!));
}
