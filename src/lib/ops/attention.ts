import { and, asc, eq, inArray, isNull, max } from "drizzle-orm";
import { board, boardColumn, changeLog, progressUpdate, system, type ColumnCategory } from "@/db/schema";
import type { Executor } from "@/db/types";
import { formatAdrNumber } from "@/lib/adr-number";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { adrsOf } from "./adrs";
import { listBlockedTasks } from "./blocked";
import { planningGapsFor } from "./planning";
import { questionsOf } from "./questions";
import { latestUpdates } from "./updates";

/** Days without activity after which an active or review system is stale. */
export const STALE_SYSTEM_DAYS = 7;
/** Days after which an unresolved question needs attention. */
export const STALE_QUESTION_DAYS = 5;
/** Days without activity after which project health calls a project quiet. */
export const HEALTH_QUIET_DAYS = 14;

/** Longest list of blocked tasks the attention list shows. */
const MAX_BLOCKED_TASKS = 20;
const DAY_MS = 86_400_000;

/** What kind of thing needs attention. */
export type AttentionKind = "blocked" | "blocked-task" | "stale" | "planning" | "decision" | "question";

/** The facts each kind of attention item is written from, so the UI can phrase them in the reader's language. */
export type AttentionParams =
  | { kind: "blocked"; system: string; summary: string | null }
  | { kind: "blocked-task"; id: number; system: string; reason: string | null }
  | { kind: "stale"; system: string; days: number }
  | { kind: "planning"; system: string; areas: string[]; open: number; noSpec: boolean }
  | { kind: "decision"; number: string; title: string }
  | { kind: "question"; blocking: boolean; author: string; answered: boolean };

/**
 * One row of a project's "Needs attention" list. `title` and `detail` are English text for agent-facing
 * consumers; the screen writes its own text from `params`.
 */
export type AttentionItem = {
  key: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  href: string;
  /** When the thing happened or was asked, for ages; `null` when it has no single moment. */
  at: Date | null;
  systemId: string | null;
  params: AttentionParams;
};

/** Joins words as "a", "a and b" or "a, b and c". */
function joinAnd(words: string[]): string {
  return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Reads the facts out of planning gaps: the areas without an answer, the open items and whether the spec is missing. */
function planningFacts(gaps: string[]): { areas: string[]; open: number; noSpec: boolean } {
  return {
    areas: gaps.flatMap((g) => /^Area (.+) has no answered item\.$/.exec(g)?.[1] ?? []),
    open: gaps.filter((g) => g.startsWith("Item ")).length,
    noSpec: gaps.some((g) => g.startsWith("No spec")),
  };
}

/** Turns planning gaps into one human sentence ("Scope and risks have no answer yet; 2 items are still open."). */
function planningDetail({ areas, open, noSpec }: { areas: string[]; open: number; noSpec: boolean }): string {
  const parts: string[] = [];
  if (areas.length) parts.push(`${joinAnd(areas)} ${areas.length === 1 ? "has" : "have"} no answer yet`);
  if (open) parts.push(`${open} ${open === 1 ? "item is" : "items are"} still open`);
  if (noSpec) parts.push("no spec is written");
  if (parts.length === 0) return "Everything is answered; planning can be completed.";
  const text = parts.join("; ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}

/**
 * Returns the newest of each system's progress updates and change-log entries
 * across several projects, from two grouped queries. Systems without either are absent.
 *
 * @param projectIds the projects whose systems to look at
 * @returns the last activity keyed by system id
 */
export async function lastActivityBySystemMany(db: Executor, projectIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (projectIds.length === 0) return out;
  const [updates, changes] = await Promise.all([
    db
      .select({ systemId: progressUpdate.systemId, at: max(progressUpdate.createdAt) })
      .from(progressUpdate)
      .innerJoin(system, eq(system.id, progressUpdate.systemId))
      .where(inArray(system.projectId, projectIds))
      .groupBy(progressUpdate.systemId),
    db
      .select({ systemId: changeLog.systemId, at: max(changeLog.createdAt) })
      .from(changeLog)
      .where(inArray(changeLog.projectId, projectIds))
      .groupBy(changeLog.systemId),
  ]);
  for (const { systemId, at } of [...updates, ...changes]) {
    if (systemId === null || at === null) continue;
    const seen = out.get(systemId);
    if (!seen || at > seen) out.set(systemId, at);
  }
  return out;
}

/**
 * Returns the newest of each system's progress updates and change-log entries,
 * from two grouped queries. Systems without either are absent.
 *
 * @param projectId the project whose systems to look at
 * @returns the last activity keyed by system id
 */
export function lastActivityBySystem(db: Executor, projectId: string): Promise<Map<string, Date>> {
  return lastActivityBySystemMany(db, [projectId]);
}

/**
 * Lists what needs someone's attention in a project, in this order: blocked
 * systems, blocked tasks (20 at most, oldest first), stale active or review
 * systems, systems in planning, proposed ADRs, and unresolved questions that
 * are blocking or older than {@link STALE_QUESTION_DAYS} days. Archived
 * systems and their questions are left out. Viewer or higher.
 *
 * @param now the reference time for ages and staleness
 */
export async function projectAttention(db: Executor, actor: Actor, projectSlug: string, now: Date): Promise<AttentionItem[]> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const base = `/p/${project.slug}`;
  const systems: { id: string; slug: string; title: string; category: ColumnCategory; createdAt: Date }[] = await db
    .select({ id: system.id, slug: system.slug, title: system.title, category: boardColumn.category, createdAt: system.createdAt })
    .from(system)
    .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
    .innerJoin(board, eq(board.id, system.boardId))
    .where(and(eq(system.projectId, project.id), isNull(system.archivedAt)))
    .orderBy(asc(board.sortOrder), asc(system.sortOrder));
  const bySlug = new Map(systems.map((s) => [s.slug, s]));
  const planning = systems.filter((s) => s.category === "planning");
  const [latest, activity, blockedTasks, gaps, adrs, questions] = await Promise.all([
    latestUpdates(db, project.id),
    lastActivityBySystem(db, project.id),
    listBlockedTasks(db, actor, projectSlug),
    planningGapsFor(db, planning.map((s) => s.id)),
    adrsOf(db, project.id, { status: "proposed" }),
    questionsOf(db, project.id, { resolved: false }),
  ]);
  const staleBefore = now.getTime() - STALE_SYSTEM_DAYS * DAY_MS;
  const questionBefore = now.getTime() - STALE_QUESTION_DAYS * DAY_MS;

  const items: AttentionItem[] = [];
  for (const s of systems.filter((s) => s.category === "blocked")) {
    const update = latest.get(s.id);
    items.push({
      key: `blocked-${s.id}`,
      kind: "blocked",
      title: `${s.title} is blocked`,
      detail: update ? update.summary : "No update explains why yet.",
      href: `${base}/systems/${s.slug}`,
      at: update?.createdAt ?? null,
      systemId: s.id,
      params: { kind: "blocked", system: s.title, summary: update?.summary ?? null },
    });
  }
  for (const t of blockedTasks.slice(0, MAX_BLOCKED_TASKS)) {
    items.push({
      key: `blocked-task-${t.id}`,
      kind: "blocked-task",
      title: `Task #${t.id} is blocked`,
      detail: `${t.systemTitle} · ${t.reason ?? "no reason given"}`,
      href: `${base}/systems/${t.systemSlug}`,
      at: t.since,
      systemId: bySlug.get(t.systemSlug)?.id ?? null,
      params: { kind: "blocked-task", id: t.id, system: t.systemTitle, reason: t.reason ?? null },
    });
  }
  for (const s of systems.filter((s) => s.category === "active" || s.category === "review")) {
    const last = activity.get(s.id) ?? s.createdAt;
    if (last.getTime() >= staleBefore) continue;
    items.push({
      key: `stale-${s.id}`,
      kind: "stale",
      title: `${s.title} has had no update for ${Math.floor((now.getTime() - last.getTime()) / DAY_MS)} days`,
      detail: "Last activity",
      href: `${base}/systems/${s.slug}`,
      at: last,
      systemId: s.id,
      params: { kind: "stale", system: s.title, days: Math.floor((now.getTime() - last.getTime()) / DAY_MS) },
    });
  }
  for (const s of planning) {
    const facts = planningFacts(gaps.get(s.id) ?? []);
    items.push({
      key: `planning-${s.id}`,
      kind: "planning",
      title: `${s.title} is still in planning`,
      detail: planningDetail(facts),
      href: `${base}/systems/${s.slug}?tab=planning`,
      at: null,
      systemId: s.id,
      params: { kind: "planning", system: s.title, ...facts },
    });
  }
  for (const a of adrs) {
    items.push({
      key: `adr-${a.number}`,
      kind: "decision",
      title: `ADR-${formatAdrNumber(a.number)} is waiting for acceptance`,
      detail: a.title,
      href: `${base}/adrs/${a.number}`,
      at: a.createdAt,
      systemId: null,
      params: { kind: "decision", number: formatAdrNumber(a.number), title: a.title },
    });
  }
  // `questionsOf` ranks blocking questions first, then normal and nice ones, newest first.
  for (const q of questions) {
    const blocking = q.priority === "blocking";
    if (!blocking && q.createdAt.getTime() >= questionBefore) continue;
    const owner = q.systemSlug === null ? null : (bySlug.get(q.systemSlug) ?? undefined);
    if (owner === undefined) continue;
    items.push({
      key: `question-${q.id}`,
      kind: "question",
      title: q.title,
      detail: `${blocking ? "Blocking · " : ""}Asked by ${q.author}${q.answer ? ", answered but not resolved." : ", no answer yet."}`,
      href: owner ? `${base}/questions?system=${owner.slug}` : `${base}/questions`,
      at: q.createdAt,
      systemId: owner?.id ?? null,
      params: { kind: "question", blocking, author: q.author, answered: Boolean(q.answer) },
    });
  }
  return items;
}
