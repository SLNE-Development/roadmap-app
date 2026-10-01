import { useTranslations } from "next-intl";
import { areaKey } from "@/components/system/text";
import type { AreaCoverage } from "@/lib/planning-coverage";

/**
 * Per-area coverage of the planning interview: a segmented bar of settled
 * and open questions, the counts, and a chip with the reason when an area is thin.
 */
export function CoverageMap({ coverage }: { coverage: AreaCoverage[] }) {
  const t = useTranslations("planning.coverage");
  const te = useTranslations("enums.planningArea");
  return (
    <ul role="list" className="flex flex-col gap-3 border bg-card px-4 py-3.5 sm:px-5">
      {coverage.map((c) => {
        const settled = c.answered + c.acceptedRisk;
        const pct = (n: number) => (c.asked === 0 ? 0 : (n / c.asked) * 100);
        return (
          <li key={c.area} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="w-36 shrink-0 text-[13px] font-medium">{te(areaKey(c.area))}</span>
              <div
                role="img"
                aria-label={t("settledLabel", { area: te(areaKey(c.area)), settled, asked: c.asked })}
                className="flex h-2 min-w-24 flex-1 overflow-hidden bg-track"
              >
                <div className="bg-cat-done" style={{ width: `${pct(c.answered)}%` }} />
                <div className="bg-cat-review" style={{ width: `${pct(c.acceptedRisk)}%` }} />
                <div className="bg-cat-planning" style={{ width: `${pct(c.open)}%` }} />
              </div>
              <span className="text-xs text-muted-foreground">
                {t("counts", { asked: c.asked, settled, open: c.open })}
              </span>
            </div>
            {c.thin && c.reason && (
              <p className="text-xs">
                <span className="inline-block bg-cat-review-soft px-1.5 py-0.5 font-semibold text-cat-review">{t("thin", { reason: c.reason })}</span>
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
