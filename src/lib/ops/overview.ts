import type { FieldType } from "@/db/schema";
import type { Executor } from "@/db/types";
import type { Actor } from "./actor";
import { adrsOf, type AdrSummary } from "./adrs";
import { dependenciesOf, type SystemDependencies } from "./dependencies";
import { codeLinksOf, OVERVIEW_CODE_LIMIT, type CodeLinkView } from "./github-links";
import { fieldsOf, fieldValuesByKey } from "./fields";
import { latestDocument, type DocumentView } from "./documents";
import { planningOf } from "./planning";
import { questionsOf, type QuestionItem } from "./questions";
import { getSystem, type SystemDetail } from "./systems";
import { updatesOf, type UpdateItem } from "./updates";

/** Everything known about one system, as agents and the system page need it. */
export interface SystemOverview extends SystemDetail {
  spec: DocumentView | null;
  plan: DocumentView | null;
  planning: { complete: boolean; gaps: string[]; rounds: number };
  questions: QuestionItem[];
  adrs: AdrSummary[];
  updates: UpdateItem[];
  dependencies: SystemDependencies;
  /** Pull requests and commits that mention the system or its tasks, newest first, at most 20. */
  code: CodeLinkView[];
  /** The project's custom fields in order, each with this system's value. */
  fields: { key: string; name: string; type: FieldType; options: string[]; value: string | null }[];
}

/**
 * Returns a system with its latest spec and plan, planning state, questions,
 * linked ADRs, its newest progress updates and its dependencies.
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
  const [spec, plan, planning, questions, adrs, updates, dependencies, definitions, code] = await Promise.all([
    latestDocument(db, detail.system.id, "spec"),
    latestDocument(db, detail.system.id, "plan"),
    planningOf(db, detail.system),
    questionsOf(db, detail.project.id, { systemId: detail.system.id }),
    adrsOf(db, detail.project.id, { systemId: detail.system.id }),
    updatesOf(db, detail.system.id, detail.project.id, updatesLimit),
    dependenciesOf(db, detail.system.id),
    fieldsOf(db, detail.project.id),
    codeLinksOf(db, detail.system.id, OVERVIEW_CODE_LIMIT),
  ]);
  const values = (await fieldValuesByKey(db, detail.project.id)).get(detail.system.id) ?? {};
  return {
    ...detail,
    spec,
    plan,
    planning: { complete: planning.completedAt !== null, gaps: planning.gaps, rounds: planning.rounds.length },
    questions,
    adrs,
    updates,
    dependencies,
    code,
    fields: definitions.map((f) => ({ key: f.key, name: f.name, type: f.type, options: f.options, value: values[f.key] ?? null })),
  };
}
