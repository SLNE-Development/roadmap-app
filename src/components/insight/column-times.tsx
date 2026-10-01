import Link from "next/link";
import { CATEGORY_CLASS, CATEGORY_LABEL, StatusChip } from "@/components/chips";
import { COLUMN_CATEGORIES } from "@/db/schema";
import type { ColumnTimes as ColumnTimesData } from "@/lib/ops/insight";

const DAY_MS = 86_400_000;
const SHOWN = 10;

/** Days with one decimal under 2 days, whole days above: "1.5 d", "6 d". */
export function formatDays(ms: number): string {
  const days = ms / DAY_MS;
  return days < 2 ? `${(Math.round(days * 10) / 10).toString()} d` : `${Math.round(days)} d`;
}

/**
 * The systems that have sat longest in their current column category, each
 * with a thin stacked bar of the time it spent in every category.
 *
 * @param props.systems the systems of the column times, longest first
 * @param props.slug the project slug
 */
export function ColumnTimes({ systems, slug }: { systems: ColumnTimesData["systems"]; slug: string }) {
  const rows = [...systems].sort((a, b) => b.currentSinceMs - a.currentSinceMs).slice(0, SHOWN);
  if (rows.length === 0) return <p className="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">No systems yet.</p>;
  return (
    <table className="w-full text-[13px]">
      <thead className="text-left text-xs text-muted-foreground">
        <tr>
          <th scope="col" className="px-4 py-2 font-medium sm:px-5">System</th>
          <th scope="col" className="py-2 font-medium">Now</th>
          <th scope="col" className="py-2 font-medium">In category for</th>
          <th scope="col" className="py-2 pr-4 font-medium sm:pr-5">Time per category</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const total = Object.values(s.byCategory).reduce((a, b) => a + b, 0);
          return (
            <tr key={s.slug} className="border-t">
              <td className="px-4 py-2 sm:px-5">
                <Link href={`/p/${slug}/systems/${s.slug}`} className="hover:underline focus-visible:underline focus-visible:outline-none">
                  {s.title}
                </Link>
              </td>
              <td className="py-2">
                <StatusChip category={s.current} name={CATEGORY_LABEL[s.current]} />
              </td>
              <td className="py-2 whitespace-nowrap tabular-nums">in category for {formatDays(s.currentSinceMs)}</td>
              <td className="py-2 pr-4 sm:pr-5">
                <div className="flex h-1.5 w-full min-w-24 bg-secondary">
                  {[...COLUMN_CATEGORIES, "unknown" as const].map((c) =>
                    s.byCategory[c] > 0 ? (
                      <span key={c} className={c === "unknown" ? "bg-border" : CATEGORY_CLASS[c]} style={{ width: `${(s.byCategory[c] / total) * 100}%` }} />
                    ) : null,
                  )}
                </div>
                <span className="sr-only">
                  {[...COLUMN_CATEGORIES, "unknown" as const]
                    .filter((c) => s.byCategory[c] > 0)
                    .map((c) => `${c === "unknown" ? "Unknown" : CATEGORY_LABEL[c]} ${formatDays(s.byCategory[c])}`)
                    .join(", ")}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
