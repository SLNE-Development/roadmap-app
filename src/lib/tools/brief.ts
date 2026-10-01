import { z } from "zod";
import type { HistoryEntry } from "@/lib/ops/activity";
import type { AdrSummary } from "@/lib/ops/adrs";
import type { DocumentView } from "@/lib/ops/documents";
import type { SystemOverview } from "@/lib/ops/overview";

/** The `brief` input shared by tools that can leave out long bodies. */
export const BRIEF = { brief: z.boolean().optional() };

/** A document without its body. */
export interface DocumentMeta {
  version: number;
  createdAt: Date;
  authorName: string;
  agent: string | null;
  chars: number;
}

/** A progress update reduced to what a status check needs. */
export interface BriefUpdate {
  id: string;
  createdAt: Date;
  authorName: string;
  agent: string | null;
  summary: string;
}

/** {@link SystemOverview} with document metadata instead of bodies and only the newest updates. */
export type BriefSystemOverview = Omit<SystemOverview, "spec" | "plan" | "updates" | "code"> & {
  spec: DocumentMeta | null;
  plan: DocumentMeta | null;
  updates: BriefUpdate[];
};

/** How many updates a brief overview keeps. */
const BRIEF_UPDATES = 3;

/** Longest change value kept by {@link briefActivity}. */
const BRIEF_VALUE_CHARS = 120;

function documentMeta(d: DocumentView | null): DocumentMeta | null {
  return d && { version: d.version, createdAt: d.createdAt, authorName: d.authorName, agent: d.agent, chars: d.body.length };
}

/** Replaces spec and plan bodies by their metadata, keeps the newest 3 updates and leaves out the code links. */
export function briefOverview({ code, ...o }: SystemOverview): BriefSystemOverview {
  void code;
  return {
    ...o,
    spec: documentMeta(o.spec),
    plan: documentMeta(o.plan),
    updates: o.updates.slice(0, BRIEF_UPDATES).map((u) => ({ id: u.id, createdAt: u.createdAt, authorName: u.authorName, agent: u.agent, summary: u.summary })),
  };
}

/** Reduces each ADR to its number, title, status, systems and successor. */
export function briefAdrs(rows: AdrSummary[]) {
  return rows.map((r) => ({ number: r.number, title: r.title, status: r.status, systems: r.systems, supersededBy: r.supersededBy }));
}

function cut(value: string | null): string | null {
  return value !== null && value.length > BRIEF_VALUE_CHARS ? `${value.slice(0, BRIEF_VALUE_CHARS)}…` : value;
}

/** Truncates old and new values to 120 characters. */
export function briefActivity(rows: HistoryEntry[]): HistoryEntry[] {
  return rows.map((r) => ({ ...r, oldValue: cut(r.oldValue), newValue: cut(r.newValue) }));
}
