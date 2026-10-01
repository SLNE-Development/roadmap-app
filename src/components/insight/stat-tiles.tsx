import { useFormatter, useTranslations } from "next-intl";
import type { Projection } from "@/lib/insight/burnup";

/** Window lengths of the range control, in days, with the `insight.ranges` key of each label. */
export const RANGES = [
  { days: 14, key: "d14" },
  { days: 42, key: "d42" },
  { days: 90, key: "d90" },
  { days: 180, key: "d180" },
  { days: 365, key: "d365" },
] as const;

/**
 * Returns a function turning a projection into the finish text: the date range in the UTC days of its keys
 * ("20–29 Oct", or "29 Oct – 3 Nov"), "Done", "No tasks yet" or "Not enough pace yet".
 */
export function useFinishText(): (projection: Projection) => string {
  const t = useTranslations("insight.stats");
  const format = useFormatter();
  return (projection) => {
    if (projection.status === "done") return t("finishDone");
    if (projection.status === "none") return projection.reason === "no-scope" ? t("finishNoScope") : t("finishNoPace");
    const day = (key: string) => new Date(`${key}T00:00:00Z`);
    return format.dateTimeRange(day(projection.earliest), day(projection.latest), { day: "numeric", month: "short", timeZone: "UTC" });
  };
}

/** One big number with a caption. */
function Tile({ value, caption }: { value: string; caption: string }) {
  return (
    <div className="flex flex-col gap-1 border bg-card px-4 py-3.5">
      <span className="text-[22px] leading-tight font-semibold tabular-nums">{value}</span>
      <span className="text-[12.5px] text-fg-2">{caption}</span>
    </div>
  );
}

/**
 * The three tiles above the burn-up: tasks done of scope, scope added in the
 * range and the projected finish.
 *
 * @param props.range the label of the chosen window, such as "6 weeks"
 */
export function StatTiles({
  totals,
  scopeAdded,
  projection,
  range,
}: {
  totals: { scope: number; done: number };
  scopeAdded: number;
  projection: Projection;
  range: string;
}) {
  const t = useTranslations("insight.stats");
  const finishText = useFinishText();
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile value={`${totals.done} / ${totals.scope}`} caption={t("tasksDone")} />
      <Tile value={scopeAdded >= 0 ? `+${scopeAdded}` : String(scopeAdded)} caption={t("scopeAdded", { range })} />
      <Tile value={finishText(projection)} caption={t("projectedFinish")} />
    </div>
  );
}
