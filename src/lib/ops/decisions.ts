import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { adr, ADR_STATUSES, adrSystem, adrTask, boardColumn, system, task, type AdrStatus, type ColumnCategory } from "@/db/schema";
import type { Executor } from "@/db/types";
import { projectAccess } from "./access";
import type { Actor } from "./actor";

/** Input of {@link getDecisionGraph}: whether to include systems and tasks, and an optional status filter. */
export const decisionGraphInput = z.object({
  systems: z.boolean().default(true),
  tasks: z.boolean().default(false),
  status: z.enum(ADR_STATUSES).optional(),
});

/** A node of the decision map; ids are `adr:<id>`, `sys:<id>` and `task:<id>`. */
export type DecisionNode =
  | { kind: "adr"; id: string; number: number; title: string; status: AdrStatus }
  | { kind: "system"; id: string; slug: string; title: string; category: ColumnCategory }
  | { kind: "task"; id: string; taskId: number; title: string; systemSlug: string };

/** An edge of the decision map: the newer ADR to the one it supersedes, or an ADR to a system or task. */
export interface DecisionEdge {
  from: string;
  to: string;
  kind: "supersedes" | "concerns" | "task";
}

/**
 * The project's decisions as a graph: ADRs, the supersedes chains between them
 * and, optionally, the systems and tasks they link to. Archived systems and
 * their tasks are left out, and a status filter keeps only the linked work of
 * the remaining ADRs. Viewer or higher.
 */
export async function getDecisionGraph(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  raw: z.input<typeof decisionGraphInput>,
): Promise<{ nodes: DecisionNode[]; edges: DecisionEdge[] }> {
  const input = decisionGraphInput.parse(raw);
  const { project: found } = await projectAccess(db, actor, projectSlug, "viewer");
  const adrs = await db
    .select()
    .from(adr)
    .where(input.status ? and(eq(adr.projectId, found.id), eq(adr.status, input.status)) : eq(adr.projectId, found.id))
    .orderBy(asc(adr.number));
  const nodes: DecisionNode[] = adrs.map((a) => ({ kind: "adr", id: `adr:${a.id}`, number: a.number, title: a.title, status: a.status }));
  const edges: DecisionEdge[] = [];
  const shown = new Set(adrs.map((a) => a.id));
  for (const a of adrs) if (a.supersedesId && shown.has(a.supersedesId)) edges.push({ from: `adr:${a.id}`, to: `adr:${a.supersedesId}`, kind: "supersedes" });
  if (adrs.length === 0) return { nodes, edges };
  const adrIds = adrs.map((a) => a.id);

  if (input.systems) {
    const rows = await db
      .select({ adrId: adrSystem.adrId, id: system.id, slug: system.slug, title: system.title, category: boardColumn.category })
      .from(adrSystem)
      .innerJoin(system, eq(system.id, adrSystem.systemId))
      .innerJoin(boardColumn, eq(boardColumn.id, system.columnId))
      .where(and(inArray(adrSystem.adrId, adrIds), isNull(system.archivedAt)))
      .orderBy(asc(system.slug));
    for (const r of rows) {
      if (!nodes.some((n) => n.id === `sys:${r.id}`)) nodes.push({ kind: "system", id: `sys:${r.id}`, slug: r.slug, title: r.title, category: r.category });
      edges.push({ from: `adr:${r.adrId}`, to: `sys:${r.id}`, kind: "concerns" });
    }
  }
  if (input.tasks) {
    const rows = await db
      .select({ adrId: adrTask.adrId, id: task.id, title: task.title, systemSlug: system.slug })
      .from(adrTask)
      .innerJoin(task, eq(task.id, adrTask.taskId))
      .innerJoin(system, eq(system.id, task.systemId))
      .where(and(inArray(adrTask.adrId, adrIds), isNull(system.archivedAt)))
      .orderBy(asc(task.id));
    for (const r of rows) {
      if (!nodes.some((n) => n.id === `task:${r.id}`)) nodes.push({ kind: "task", id: `task:${r.id}`, taskId: r.id, title: r.title, systemSlug: r.systemSlug });
      edges.push({ from: `adr:${r.adrId}`, to: `task:${r.id}`, kind: "task" });
    }
  }
  return { nodes, edges };
}
