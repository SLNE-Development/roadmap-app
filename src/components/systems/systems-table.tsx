import Link from "next/link";
import { CATEGORY_CLASS, PriorityTag, StatusChip } from "@/components/chips";
import { useNow } from "@/components/clock";
import { ProgressBar } from "@/components/page";
import { PersonName } from "@/components/person-avatar";
import { Checkbox } from "@/components/ui/checkbox";
import type { SystemListItem } from "@/lib/ops/systems";
import { relativeAge } from "@/lib/time";

/** A group of systems under a heading; `name` is empty when the list is ungrouped. */
export interface SystemGroup {
  key: string;
  name: string;
  items: SystemListItem[];
}

/** Classes of the grid shared by the header and every row. */
const GRID = "grid items-center gap-4";

/** Width of one custom field column. */
const FIELD_WIDTH = 130;

/** Row selection of the systems table; omit it for read-only viewers. */
export interface SystemSelection {
  /** Slugs of the selected systems. */
  selected: ReadonlySet<string>;
  onToggle: (slug: string, checked: boolean) => void;
  /** Selects, or clears, every visible row. */
  onToggleAll: (checked: boolean) => void;
}

/**
 * The systems table: one row per system with status, priority, owner, phase,
 * task progress and the age of its latest update, under group header rows,
 * followed by one column per custom field.
 *
 * @param props.fields the project's custom fields, one column each
 * @param props.phaseName the phase name of a phase id
 * @param props.updatedAt the ISO time of each system's latest update, by id
 * @param props.selection when given, adds a checkbox column
 */
export function SystemsTable({
  groups,
  projectSlug,
  phaseName,
  updatedAt,
  fields,
  selection,
}: {
  groups: SystemGroup[];
  projectSlug: string;
  phaseName: Record<string, string>;
  updatedAt: Record<string, string>;
  fields: { key: string; name: string }[];
  selection?: SystemSelection;
}) {
  const now = useNow();
  const visible = groups.reduce((n, g) => n + g.items.length, 0);
  const picked = groups.reduce((n, g) => n + g.items.filter((s) => selection?.selected.has(s.slug)).length, 0);
  const template = {
    gridTemplateColumns: `${selection ? "16px " : ""}minmax(0,2.4fr) 130px 110px 170px 130px 130px 80px${` ${FIELD_WIDTH}px`.repeat(fields.length)}`,
  };
  return (
    <div className="overflow-x-auto border bg-card">
      <div role="table" aria-label="Systems" className="flex min-w-max flex-col">
        <div role="rowgroup">
          <div role="row" style={template} className={`${GRID} border-b px-4 py-[9px] text-xs font-semibold text-muted-foreground`}>
            {selection && (
              <span role="columnheader">
                <Checkbox
                  aria-label="Select all visible systems"
                  checked={picked === 0 ? false : picked === visible ? true : "indeterminate"}
                  onCheckedChange={(checked) => selection.onToggleAll(checked === true)}
                />
              </span>
            )}
            <span role="columnheader">System</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Priority</span>
            <span role="columnheader">Owner</span>
            <span role="columnheader">Phase</span>
            <span role="columnheader">Tasks</span>
            <span role="columnheader" className="text-right">
              Updated
            </span>
            {fields.map((f) => (
              <span role="columnheader" key={f.key} className="truncate">
                {f.name}
              </span>
            ))}
          </div>
        </div>
        {groups.map((g) => (
          <div role="rowgroup" key={g.key}>
            {g.name && (
              <div role="row" className="flex items-baseline gap-2.5 border-b bg-background px-4 pt-2.5 pb-1.5">
                <span role="rowheader" className="text-[13px] font-semibold">
                  {g.name}
                </span>
                <span className="text-xs text-muted-foreground">{g.items.length}</span>
              </div>
            )}
            {g.items.map((s) => (
              <div role="row" key={s.id} style={template} className={`${GRID} relative border-b px-4 py-2.5 text-[13.5px] last:border-b-0 hover:bg-muted/50`}>
                {selection && (
                  <span role="cell" className="relative z-10">
                    <Checkbox
                      aria-label={`Select ${s.title}`}
                      checked={selection.selected.has(s.slug)}
                      onCheckedChange={(checked) => selection.onToggle(s.slug, checked === true)}
                    />
                  </span>
                )}
                <span role="cell" className="flex min-w-0 flex-col gap-0.5">
                  {s.archivedAt && <span className="w-fit bg-muted px-1.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">Archived</span>}
                  <Link
                    href={`/p/${projectSlug}/systems/${s.slug}`}
                    data-nav-item
                    className="truncate font-semibold after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50"
                  >
                    {s.title}
                  </Link>
                  {s.summary && <span className="truncate text-[12.5px] text-muted-foreground">{s.summary}</span>}
                </span>
                <span role="cell">
                  <StatusChip category={s.columnCategory} name={s.columnName} />
                </span>
                <span role="cell">
                  <PriorityTag priority={s.priority} />
                </span>
                <span role="cell" className="min-w-0 truncate text-fg-2">
                  {s.ownerName ? <PersonName name={s.ownerName} size="sm" className="gap-2" /> : <span className="text-muted-foreground">Unowned</span>}
                </span>
                <span role="cell" className="truncate text-fg-2">
                  {s.phaseId ? (phaseName[s.phaseId] ?? "—") : <span className="text-muted-foreground">—</span>}
                </span>
                <span role="cell" className="flex items-center gap-2">
                  <ProgressBar value={s.tasksDone} total={s.tasksTotal} colorClass={CATEGORY_CLASS[s.columnCategory]} className="w-16 flex-none" />
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.tasksDone}/{s.tasksTotal}
                  </span>
                </span>
                <span role="cell" className="text-right text-[12.5px] text-muted-foreground">
                  {updatedAt[s.id] ? relativeAge(updatedAt[s.id], now) : "—"}
                </span>
                {fields.map((f) => (
                  <span role="cell" key={f.key} className="truncate text-fg-2">
                    {s.fields[f.key] ?? <span className="text-muted-foreground">—</span>}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
