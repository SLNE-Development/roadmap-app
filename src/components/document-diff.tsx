import { EmptyState } from "@/components/page";
import { cn } from "@/lib/utils";
import type { DiffHunk, DiffLine } from "@/lib/diff";

const ROW: Record<DiffLine["kind"], string> = { same: "", add: "bg-cat-done-soft", del: "bg-danger-soft" };
const MARK: Record<DiffLine["kind"], string> = { same: "", add: "bg-cat-done/25", del: "bg-destructive/25" };
const SIGN: Record<DiffLine["kind"], string> = { same: " ", add: "+", del: "−" };

/** One diff row: both line numbers, the sign and the text with changed words marked. */
function Row({ line }: { line: DiffLine }) {
  return (
    <tr className={ROW[line.kind]}>
      <td className="w-10 px-2 text-right text-muted-foreground select-none">{line.oldNo}</td>
      <td className="w-10 px-2 text-right text-muted-foreground select-none">{line.newNo}</td>
      <td className="w-5 text-center select-none" aria-label={line.kind === "add" ? "Added" : line.kind === "del" ? "Removed" : undefined}>
        {SIGN[line.kind]}
      </td>
      <td className="pr-4 whitespace-pre">
        {line.parts.map((p, i) =>
          p.changed && line.kind !== "same" ? (
            <mark key={i} className={cn("text-inherit", MARK[line.kind])}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </td>
    </tr>
  );
}

/**
 * The differences between two versions: a "+6 −3" summary, then each hunk under
 * its heading with two line-number gutters. Scrolls sideways inside its own box.
 *
 * @param props.from the older version number
 * @param props.to the newer version number
 */
export function DocumentDiff({ hunks, added, removed, from, to }: { hunks: DiffHunk[]; added: number; removed: number; from: number; to: number }) {
  if (hunks.length === 0) return <EmptyState title={`No changes between v${from} and v${to}`} />;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-[13px] font-medium tabular-nums">
        <span className="text-cat-done">+{added}</span> <span className="text-destructive">−{removed}</span>
      </p>
      <div className="overflow-x-auto border font-mono text-[12.5px] leading-[1.6]">
        <table className="w-full min-w-max border-collapse">
          {hunks.map((h, i) => (
            <tbody key={i} className="border-b last:border-b-0">
              <tr className="bg-muted text-muted-foreground">
                <th colSpan={4} scope="colgroup" className="px-3 py-1 text-left font-normal">
                  {h.header}
                </th>
              </tr>
              {h.lines.map((l, n) => (
                <Row key={n} line={l} />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
