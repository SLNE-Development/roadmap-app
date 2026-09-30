import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import type { HistoryEntry } from "@/lib/ops/activity";

/** A change log entry with its timestamp as an ISO string. */
export type HistoryView = Omit<HistoryEntry, "createdAt"> & { createdAt: string };

/** Shortens long values such as notes for one-line display. */
function short(value: string | null): string {
  if (value == null || value === "") return "—";
  return value.length > 80 ? `${value.slice(0, 77)}…` : value;
}

/** Renders change log entries, newest first. */
export function HistoryList({ entries, showEntity = false }: { entries: HistoryView[]; showEntity?: boolean }) {
  if (entries.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No changes yet</EmptyTitle>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ol className="flex flex-col gap-2 text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex flex-wrap gap-x-2">
          <time className="font-mono text-xs text-muted-foreground" dateTime={e.createdAt}>
            {e.createdAt.slice(0, 16).replace("T", " ")}
          </time>
          <span className="font-medium">{e.author}</span>
          <span className="text-muted-foreground">
            {showEntity && <span className="font-mono text-xs">{e.entity} </span>}
            {e.field}: {short(e.oldValue)} → {short(e.newValue)}
          </span>
        </li>
      ))}
    </ol>
  );
}
