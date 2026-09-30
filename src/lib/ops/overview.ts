import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { listAdrs, type AdrSummary } from "./adrs";
import { latestDocument, type DocumentView } from "./documents";
import { getPlanning } from "./planning";
import { listQuestions, type QuestionItem } from "./questions";
import { getSystem, type SystemDetail } from "./systems";
import { listUpdates, type UpdateItem } from "./updates";

/** Everything known about one system, as agents and the system page need it. */
export interface SystemOverview extends SystemDetail {
  spec: DocumentView | null;
  plan: DocumentView | null;
  planning: { complete: boolean; gaps: string[]; rounds: number };
  questions: QuestionItem[];
  adrs: AdrSummary[];
  updates: UpdateItem[];
}

/**
 * Returns a system with its latest spec and plan, planning state, questions,
 * linked ADRs and its newest progress updates.
 *
 * @param updatesLimit how many updates to include, newest first
 */
export async function getSystemOverview(
  db: Executor,
  actor: Actor,
  projectSlug: string,
  systemSlug: string,
  updatesLimit = 10,
): Promise<SystemOverview> {
  const detail = await getSystem(db, actor, projectSlug, systemSlug);
  const [spec, plan, planning, questions, adrs, updates] = await Promise.all([
    latestDocument(db, detail.system.id, "spec"),
    latestDocument(db, detail.system.id, "plan"),
    getPlanning(db, actor, projectSlug, systemSlug),
    listQuestions(db, actor, projectSlug, { system: systemSlug }),
    listAdrs(db, actor, projectSlug, { system: systemSlug }),
    listUpdates(db, actor, projectSlug, { system: systemSlug, limit: updatesLimit }),
  ]);
  return {
    ...detail,
    spec,
    plan,
    planning: { complete: planning.completedAt !== null, gaps: planning.gaps, rounds: planning.rounds.length },
    questions,
    adrs,
    updates,
  };
}
