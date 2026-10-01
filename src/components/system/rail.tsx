import { Check, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ConfirmationQuote } from "@/components/planning-rounds";
import { formatAdrNumber } from "@/lib/adr-number";
import type { AdrSummary } from "@/lib/ops/adrs";
import type { PlanningView } from "@/lib/ops/planning";
import type { QuestionItem } from "@/lib/ops/questions";
import { useGapText } from "./text";

/** "2 rounds · 7 answers · 1 accepted risk" for a planning interview. */
function usePlanningStats(): (planning: PlanningView) => string {
  const t = useTranslations("system.planningPanel");
  return (planning) => {
    const items = planning.rounds.flatMap((r) => r.items);
    const answers = items.filter((i) => i.status === "answered").length;
    const risks = items.filter((i) => i.status === "accepted-risk").length;
    const parts = [t("rounds", { count: planning.rounds.length }), t("answers", { count: answers })];
    if (risks) parts.push(t("acceptedRisks", { count: risks }));
    return parts.join(" · ");
  };
}

/**
 * The Planning panel of the right rail. Complete: a check, the rounds summary
 * and the user's confirmation. Incomplete: a lock and the gaps that keep the
 * system in planning, in planning colours.
 */
export function PlanningPanel({ planning, href }: { planning: PlanningView; href: string }) {
  const t = useTranslations("system.planningPanel");
  const stats = usePlanningStats();
  const { line } = useGapText();
  const complete = planning.completedAt !== null;
  return (
    <section className="flex flex-col gap-2.5 border bg-card p-4">
      <div className="flex items-center gap-2">
        {complete ? (
          <span className="flex size-6 items-center justify-center bg-cat-done-soft text-cat-done">
            <Check aria-hidden className="size-[13px]" strokeWidth={2.8} />
          </span>
        ) : (
          <span className="flex size-6 items-center justify-center bg-cat-planning-soft text-cat-planning">
            <Lock aria-hidden className="size-[13px]" strokeWidth={2.4} />
          </span>
        )}
        <h2 className="flex-1 text-sm font-semibold">{complete ? t("complete") : t("inPlanning")}</h2>
        <Link href={href} className="text-[12.5px] font-medium text-brand-strong hover:underline">
          {t("roundsLink")}
        </Link>
      </div>
      <span className="text-[12.5px] text-fg-2">{stats(planning)}</span>
      {complete ? (
        planning.confirmation && (
          <ConfirmationQuote confirmation={planning.confirmation} completedAt={planning.completedAt?.toISOString() ?? null} />
        )
      ) : (
        <div className="flex flex-col gap-1.5 bg-cat-planning-soft px-3 py-2.5 text-[13px] leading-[1.45] text-cat-planning">
          <span className="flex items-center gap-2 font-medium">
            <Lock aria-hidden className="size-3.5 shrink-0" />
            {t("stillMissing")}
          </span>
          <ul className="flex flex-col gap-1 pl-[22px]">
            {planning.gaps.map((g) => (
              <li key={g}>{line(g)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The Decisions panel: linked ADRs as mono number and title, then this system's open questions. */
export function DecisionsPanel({ projectSlug, systemSlug, adrs, questions }: { projectSlug: string; systemSlug: string; adrs: AdrSummary[]; questions: QuestionItem[] }) {
  const t = useTranslations("system.decisionsPanel");
  return (
    <section className="flex flex-col gap-2 border bg-card p-4">
      <h2 className="text-sm font-semibold">{t("decisions")}</h2>
      {adrs.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {adrs.map((a) => (
            <li key={a.number}>
              <Link href={`/p/${projectSlug}/adrs/${a.number}`} className="flex items-baseline gap-2 text-[13px] leading-[1.4] hover:text-brand-strong">
                <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">{formatAdrNumber(a.number)}</span>
                <span className={a.status === "superseded" ? "text-muted-foreground line-through" : undefined}>{a.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-fg-2">{t("noDecisions")}</p>
      )}
      <h2 className="mt-2 text-sm font-semibold">{questions.length === 1 ? t("openQuestion") : t("openQuestions")}</h2>
      {questions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {questions.map((q) => (
            <li key={q.id}>
              <Link href={`/p/${projectSlug}/questions?system=${systemSlug}`} className="text-[13px] leading-[1.45] text-fg-2 hover:text-foreground hover:underline">
                {q.title}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-fg-2">{t("nothingOpen")}</p>
      )}
    </section>
  );
}
