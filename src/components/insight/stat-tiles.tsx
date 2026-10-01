import { dayTicks } from "@/lib/chart/scale";
import type { Projection } from "@/lib/insight/burnup";

/** Window lengths of the range control, in days. */
export const RANGES = [
  { days: 14, label: "2 weeks" },
  { days: 42, label: "6 weeks" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
] as const;

/** The projected finish as "20–29 Oct" (or "29 Oct – 3 Nov"), "Done", "No tasks yet" or "Not enough pace yet". */
export function finishText(projection: Projection): string {
  if (projection.status === "done") return "Done";
  if (projection.status === "none") return projection.reason === "no-scope" ? "No tasks yet" : "Not enough pace yet";
  const [from, to] = [projection.earliest, projection.latest].map((k) => dayTicks([k], 1)[0].label);
  const [fromDay, fromMonth] = from.split(" ");
  return fromMonth === to.split(" ")[1] ? `${fromDay}–${to}` : `${from} – ${to}`;
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
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Tile value={`${totals.done} / ${totals.scope}`} caption="tasks done" />
      <Tile value={scopeAdded >= 0 ? `+${scopeAdded}` : String(scopeAdded)} caption={`scope added in ${range}`} />
      <Tile value={finishText(projection)} caption="projected finish" />
    </div>
  );
}
