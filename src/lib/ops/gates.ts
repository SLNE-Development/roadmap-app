import { and, asc, count, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { adr, adrSystem, columnRule, progressUpdate, question, system, systemDocument, task } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";
import { findBoard } from "./lookup";
import { plural } from "@/lib/text";

/** A system a column's entry rules are checked for. */
export interface GateSubject {
  id: string;
  slug: string;
  projectId: string;
}

/** An entry rule a board column can require of systems moving into it. */
export interface GateRule {
  /** Stable id stored in `column_rule.rule`, e.g. "all-tasks-done". */
  id: string;
  /** Human label, e.g. "All tasks done" or "Progress update in the last 3 days". */
  label: (param: number | null) => string;
  /** The rule's numeric parameter, when it takes one. */
  param?: { min: number; max: number; default: number; unit: string };
  /** Returns, per subject id, why the rule is unmet, or null when met. One query for all subjects. */
  check: (tx: Executor, subjects: GateSubject[], param: number | null, now: Date) => Promise<Map<string, string | null>>;
}

/** Every known entry rule by id; later parts add theirs with {@link registerGateRule}. */
export const GATE_RULES = new Map<string, GateRule>();

/**
 * Adds an entry rule to {@link GATE_RULES}.
 *
 * @throws Error if a rule with the same id is registered already
 */
export function registerGateRule(rule: GateRule): void {
  if (GATE_RULES.has(rule.id)) throw new Error(`Gate rule ${rule.id} is registered already.`);
  GATE_RULES.set(rule.id, rule);
}

/** A rule stored on a column, in its order. */
export interface ColumnRuleRow {
  rule: string;
  param: number | null;
}

/** The outcome of a column's rules for one system: how many hold, and why the others do not. */
export interface GateResult {
  column: string;
  met: number;
  total: number;
  unmet: string[];
}

/** Ids of the subjects, for `inArray`. */
const idsOf = (subjects: GateSubject[]) => subjects.map((s) => s.id);

/** Builds a check result: `reason(id)` for every subject, null when met. */
function resultFor(subjects: GateSubject[], reason: (id: string) => string | null): Map<string, string | null> {
  return new Map(subjects.map((s) => [s.id, reason(s.id)]));
}

/** Formats task ids as `#1, #2`, at most five then `…`. */
function taskList(ids: number[]): string {
  const shown = ids.slice(0, 5).map((id) => `#${id}`);
  return ids.length > 5 ? `${shown.join(", ")}, …` : shown.join(", ");
}

registerGateRule({
  id: "all-tasks-done",
  label: () => "All tasks done",
  check: async (tx, subjects) => {
    const rows = await tx
      .select({ systemId: task.systemId, id: task.id })
      .from(task)
      .where(and(inArray(task.systemId, idsOf(subjects)), ne(task.state, "done")))
      .orderBy(asc(task.id));
    return resultFor(subjects, (id) => {
      const open = rows.filter((r) => r.systemId === id).map((r) => r.id);
      return open.length === 0 ? null : `${plural(open.length, "open task")} (${taskList(open)})`;
    });
  },
});

registerGateRule({
  id: "no-open-questions",
  label: () => "No open questions",
  check: async (tx, subjects) => {
    const rows = await tx
      .select({ systemId: question.systemId, n: count() })
      .from(question)
      .where(and(inArray(question.systemId, idsOf(subjects)), eq(question.resolved, false)))
      .groupBy(question.systemId);
    const counts = new Map(rows.map((r) => [r.systemId, r.n]));
    return resultFor(subjects, (id) => {
      const n = counts.get(id) ?? 0;
      return n === 0 ? null : plural(n, "open question");
    });
  },
});

registerGateRule({
  id: "spec-exists",
  label: () => "Spec exists",
  check: async (tx, subjects) => {
    const rows = await tx
      .selectDistinct({ systemId: systemDocument.systemId })
      .from(systemDocument)
      .where(and(inArray(systemDocument.systemId, idsOf(subjects)), eq(systemDocument.kind, "spec")));
    const withSpec = new Set(rows.map((r) => r.systemId));
    return resultFor(subjects, (id) => (withSpec.has(id) ? null : "no spec"));
  },
});

registerGateRule({
  id: "plan-covers-tasks",
  label: () => "Plan covers all tasks",
  check: async (tx, subjects) => {
    // One row per subject and task outside the plan (taskId null when there is none).
    const rows = await tx
      .select({
        systemId: system.id,
        taskId: task.id,
        hasPlan: sql<boolean>`exists (select 1 from ${systemDocument} where ${systemDocument.systemId} = ${system.id} and ${systemDocument.kind} = 'plan')`,
      })
      .from(system)
      .leftJoin(task, and(eq(task.systemId, system.id), isNull(task.planStep)))
      .where(inArray(system.id, idsOf(subjects)))
      .orderBy(asc(task.id));
    return resultFor(subjects, (id) => {
      const mine = rows.filter((r) => r.systemId === id);
      if (!mine.some((r) => r.hasPlan)) return "no plan";
      const outside = mine.flatMap((r) => (r.taskId === null ? [] : [r.taskId]));
      if (outside.length === 0) return null;
      return `${outside.length === 1 ? "task" : "tasks"} ${taskList(outside)} ${outside.length === 1 ? "is" : "are"} not in the plan`;
    });
  },
});

registerGateRule({
  id: "update-within-days",
  label: (param) => `Progress update in the last ${plural(param ?? 3, "day")}`,
  param: { min: 1, max: 60, default: 3, unit: "days" },
  check: async (tx, subjects, param, now) => {
    const days = param ?? 3;
    const rows = await tx
      .select({ systemId: progressUpdate.systemId, latest: max(progressUpdate.createdAt) })
      .from(progressUpdate)
      .where(inArray(progressUpdate.systemId, idsOf(subjects)))
      .groupBy(progressUpdate.systemId);
    const latest = new Map(rows.map((r) => [r.systemId, r.latest]));
    const since = now.getTime() - days * 24 * 60 * 60 * 1000;
    return resultFor(subjects, (id) => {
      const at = latest.get(id);
      return at && new Date(at).getTime() >= since ? null : `no progress update in the last ${plural(days, "day")}`;
    });
  },
});

registerGateRule({
  id: "adr-linked",
  label: () => "Accepted ADR linked",
  check: async (tx, subjects) => {
    const rows = await tx
      .selectDistinct({ systemId: adrSystem.systemId })
      .from(adrSystem)
      .innerJoin(adr, eq(adr.id, adrSystem.adrId))
      .where(and(inArray(adrSystem.systemId, idsOf(subjects)), eq(adr.status, "accepted")));
    const linked = new Set(rows.map((r) => r.systemId));
    return resultFor(subjects, (id) => (linked.has(id) ? null : "no accepted ADR linked"));
  },
});

/**
 * Checks a column's rules, in order, for every subject: one query per rule, not
 * per subject. A row without param uses the rule's default; rules no longer
 * registered are skipped.
 */
export async function evaluateGates(
  tx: Executor,
  subjects: GateSubject[],
  columnName: string,
  rules: ColumnRuleRow[],
  now: Date,
): Promise<Map<string, GateResult>> {
  const results = new Map(subjects.map((s): [string, GateResult] => [s.id, { column: columnName, met: 0, total: 0, unmet: [] }]));
  if (subjects.length === 0) return results;
  for (const row of rules) {
    const rule = GATE_RULES.get(row.rule);
    if (!rule) continue;
    const reasons = await rule.check(tx, subjects, row.param ?? rule.param?.default ?? null, now);
    for (const s of subjects) {
      const result = results.get(s.id) as GateResult;
      const reason = reasons.get(s.id) ?? null;
      result.total += 1;
      if (reason === null) result.met += 1;
      else result.unmet.push(reason);
    }
  }
  return results;
}

/** Returns the message a refused move shows, naming every unmet rule. */
export function gateMessage(systemSlug: string, result: GateResult): string {
  return `Can't move ${systemSlug} to ${result.column}. Missing: ${result.unmet.join("; ")}. Finish them, or ask a project owner to move it with overrideReason.`;
}

/** Returns the rules of each listed column, in order; columns without rules are missing from the map. */
export async function columnRulesOf(tx: Executor, columnIds: string[]): Promise<Map<string, ColumnRuleRow[]>> {
  const byColumn = new Map<string, ColumnRuleRow[]>();
  if (columnIds.length === 0) return byColumn;
  const rows = await tx
    .select({ columnId: columnRule.columnId, rule: columnRule.rule, param: columnRule.param })
    .from(columnRule)
    .where(inArray(columnRule.columnId, columnIds))
    .orderBy(asc(columnRule.sortOrder));
  for (const { columnId, ...row } of rows) byColumn.set(columnId, [...(byColumn.get(columnId) ?? []), row]);
  return byColumn;
}

/** Summarises rules for the change log, e.g. `all-tasks-done, update-within-days(3)`. */
export function rulesSummary(rules: ColumnRuleRow[]): string {
  return rules.map((r) => (r.param === null ? r.rule : `${r.rule}(${r.param})`)).join(", ");
}

/** The registered rules as the column rules editor lists them. */
export function listGateRules(): { id: string; label: string; param?: GateRule["param"] }[] {
  return [...GATE_RULES.values()].map((r) => ({ id: r.id, label: r.label(null), ...(r.param ? { param: r.param } : {}) }));
}

/**
 * Evaluates, for each active system of the board, the rules of the first column to the right
 * of its own that has any. Systems without such a column are missing from the result. One
 * evaluation per gated column, not per system.
 */
export async function boardGates(db: Executor, actor: Actor, projectSlug: string, boardSlug: string, now = new Date()): Promise<Record<string, GateResult>> {
  const { project } = await projectAccess(db, actor, projectSlug, "viewer");
  const current = await findBoard(db, project.id, boardSlug);
  const rules = await columnRulesOf(db, current.columns.map((c) => c.id));
  const subjects = await db
    .select({ id: system.id, slug: system.slug, projectId: system.projectId, columnId: system.columnId })
    .from(system)
    .where(and(eq(system.boardId, current.id), isNull(system.archivedAt)));
  const byGate = new Map<string, GateSubject[]>();
  for (const { columnId, ...subject } of subjects) {
    const here = current.columns.findIndex((c) => c.id === columnId);
    const next = current.columns.slice(here + 1).find((c) => rules.has(c.id));
    if (next) byGate.set(next.id, [...(byGate.get(next.id) ?? []), subject]);
  }
  const result: Record<string, GateResult> = {};
  for (const [columnId, list] of byGate) {
    const column = current.columns.find((c) => c.id === columnId) as (typeof current.columns)[number];
    for (const [id, gate] of await evaluateGates(db, list, column.name, rules.get(columnId) ?? [], now)) result[id] = gate;
  }
  return result;
}
