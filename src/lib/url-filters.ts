import { PRIORITIES, type Priority } from "@/db/schema";
import { LANE_KEYS, type LaneKey } from "@/lib/lanes";

/** The query keys of the board's filters and swimlanes. */
export const BOARD_FILTER_KEYS = ["q", "domain", "phase", "priority", "owner", "lane"] as const;

/** The board's filters as read from the URL; `owner` is a user id or `none`. */
export type BoardQuery = {
  q: string;
  domain: string | null;
  phase: string | null;
  priority: Priority | null;
  owner: string | null;
  lane: LaneKey;
};

/** Longest search text kept from the URL. */
const MAX_Q = 100;

/** Returns a search parameter's first value, or null when it is missing or empty. */
function first(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v : null;
}

/**
 * Reads the board's filters from the page's search params. Unknown or invalid
 * values become `null` (`"none"` for the lane).
 */
export function parseBoardQuery(sp: Record<string, string | string[] | undefined>): BoardQuery {
  const priority = first(sp.priority);
  const lane = first(sp.lane);
  return {
    q: (first(sp.q) ?? "").trim().slice(0, MAX_Q),
    domain: first(sp.domain),
    phase: first(sp.phase),
    priority: PRIORITIES.find((p) => p === priority) ?? null,
    owner: first(sp.owner),
    lane: LANE_KEYS.find((k) => k === lane) ?? "none",
  };
}

/**
 * Returns `search` with `key` set to `value`, as a query string with a leading
 * `?` or empty. `null` or `""` removes the key; the other keys keep their order.
 */
export function withParam(search: string, key: string, value: string | null): string {
  const params = new URLSearchParams(search);
  if (value) params.set(key, value);
  else params.delete(key);
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** Whether any filter other than the lane is set. */
export function hasFilters(query: BoardQuery): boolean {
  return Boolean(query.q || query.domain || query.phase || query.priority || query.owner);
}
